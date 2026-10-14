import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildScanReport } from "./impact.js";
import { WORKSPACE_ROOT, type WorkspaceOutdated } from "../workspace.js";
import { getCache, resetCacheForTests } from "../cache/manager.js";

const DEFAULT_PKG = { name: "bench", private: true, dependencies: {} };

function outdated(overrides: Partial<WorkspaceOutdated>): WorkspaceOutdated {
  return {
    name: "zod",
    current: "3.23.8",
    wanted: "3.24.0",
    latest: "4.0.5",
    workspacePath: WORKSPACE_ROOT,
    ...overrides,
  };
}

/**
 * Build a temp project plus an isolated cache dir. Seeds the digest cache via
 * the same `digest::pkg--from--to` key the real digest writer uses.
 */
async function withScanEnv(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
  seedDigest?: { name: string; from: string; to: string; changes: unknown[] },
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-impact-"));
  const cacheDir = await mkdtemp(join(tmpdir(), "greenbump-impact-cache-"));
  const prevCache = process.env.GREENBUMP_CACHE_DIR;
  process.env.GREENBUMP_CACHE_DIR = cacheDir;
  resetCacheForTests();

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
  }

  if (seedDigest) {
    const cache = getCache();
    await cache.init();
    await cache.setLlmFix(`digest::${seedDigest.name}--${seedDigest.from}--${seedDigest.to}`, {
      edits: { __digest__: JSON.stringify(seedDigest.changes) },
      hits: 0,
      model: "stub",
    });
  }

  try {
    await fn(dir);
  } finally {
    if (prevCache === undefined) delete process.env.GREENBUMP_CACHE_DIR;
    else process.env.GREENBUMP_CACHE_DIR = prevCache;
    resetCacheForTests();
    await rm(cacheDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildScanReport: codemod tier reports file/line impact with no cache and no LLM", async () => {
  await withScanEnv(
    {
      "package.json": JSON.stringify(DEFAULT_PKG),
      "src/validate.js": 'const r = schema.safeParse(d);\nreturn r.error.errors[0].message;\n',
    },
    async (dir) => {
      const report = await buildScanReport(dir, [outdated({})]);

      assert.equal(report.schemaVersion, 1);
      assert.equal(report.summary.depsScanned, 1);

      const det = report.detections[0];
      assert.equal(det.name, "zod");
      assert.equal(det.kind, "codemod");
      assert.equal(det.status, "ok");

      const errors = det.changes.find((c) => c.description.includes("error.issues"));
      assert.ok(errors, "expected the error.errors codemod to be reported");
      assert.equal(errors!.matches, 1);
      assert.equal(errors!.fileGroups.length, 1);
      assert.equal(errors!.fileGroups[0].file, join("src", "validate.js"));
      assert.equal(errors!.fileGroups[0].locations[0].line, 2);
      assert.equal(det.filesMatched, 1);
      assert.equal(det.locationsMatched, 1);
    },
  );
});

test("buildScanReport: wildcard codemods are not misattributed to an unrelated dep", async () => {
  await withScanEnv(
    {
      "package.json": JSON.stringify(DEFAULT_PKG),
      "test.js": 'assert.equal(a, b);\nconst r = z.safeParse(x);\nr.error.errors;\n',
    },
    async (dir) => {
      const report = await buildScanReport(dir, [outdated({})]);
      const det = report.detections[0];
      // `assert.equal` is a `package: "*"` codemod — it must not appear as a zod change.
      assert.ok(
        !det.changes.some((c) => c.description.includes("assert.equal")),
        "wildcard codemod leaked into the zod detection",
      );
      assert.ok(!det.changes.some((c) => c.description.includes("util.is")));
    },
  );
});

test("buildScanReport: an upgrade with no matching codemod and no cache is reported unknown", async () => {
  await withScanEnv(
    { "package.json": JSON.stringify(DEFAULT_PKG), "a.js": "whatever();\n" },
    async (dir) => {
      const report = await buildScanReport(dir, [
        outdated({ name: "left-pad", current: "1.0.0", latest: "2.0.0" }),
      ]);
      const det = report.detections[0];
      assert.equal(det.status, "unknown");
      assert.equal(det.changes.length, 0);
      assert.equal(det.displayedImpact, false);
      assert.equal(report.summary.depsWithKnownBreaking, 0);
    },
  );
});

test("buildScanReport: no cache hit means no filesystem-wide guessing (never calls an LLM)", async () => {
  await withScanEnv(
    { "package.json": JSON.stringify(DEFAULT_PKG), "a.js": "err.error.errors;\n" },
    async (dir) => {
      // No cached digest for left-pad: the zod-only codemod must not fire for it,
      // and nothing else may invent a result.
      const report = await buildScanReport(dir, [
        outdated({ name: "left-pad", current: "1.0.0", latest: "2.0.0" }),
      ]);
      assert.equal(report.detections[0].status, "unknown");
      assert.deepEqual(report.detections[0].changes, []);
    },
  );
});

test("buildScanReport: reads a seeded digest from cache and maps it to project locations", async () => {
  await withScanEnv(
    {
      "package.json": JSON.stringify(DEFAULT_PKG),
      "src/api.js": "const r = client.oldMethod();\n",
    },
    async (dir) => {
      const report = await buildScanReport(dir, [
        outdated({ name: "some-lib", current: "1.0.0", latest: "2.0.0" }),
      ]);
      const det = report.detections[0];
      assert.equal(det.kind, "digest");
      assert.equal(det.status, "ok");

      const change = det.changes.find((c) => c.description.includes("oldMethod"));
      assert.ok(change, "expected the cached digest change to be reported");
      assert.equal(change!.source, "changelog-cache");
      assert.equal(change!.matches, 1);
      assert.equal(change!.fileGroups[0].file, join("src", "api.js"));
      assert.equal(change!.fileGroups[0].locations[0].line, 1);
    },
    {
      name: "some-lib",
      from: "1.0.0",
      to: "2.0.0",
      changes: [
        {
          description: "oldMethod was replaced by newMethod",
          oldApi: "client.oldMethod()",
          newApi: "client.newMethod()",
          severity: "high",
        },
      ],
    },
  );
});

test("buildScanReport: --no-cache ignores a seeded digest and falls back to codemods", async () => {
  await withScanEnv(
    {
      "package.json": JSON.stringify(DEFAULT_PKG),
      "src/api.js": "const r = client.oldMethod();\n",
    },
    async (dir) => {
      const report = await buildScanReport(
        dir,
        [outdated({ name: "some-lib", current: "1.0.0", latest: "2.0.0" })],
        { noCache: true },
      );
      const det = report.detections[0];
      assert.equal(det.status, "unknown");
      assert.deepEqual(det.changes, []);
    },
    {
      name: "some-lib",
      from: "1.0.0",
      to: "2.0.0",
      changes: [
        { description: "oldMethod gone", oldApi: "client.oldMethod()", severity: "high" },
      ],
    },
  );
});

test("buildScanReport: breaking changes that touch nothing report zero impact, not an error", async () => {
  await withScanEnv(
    { "package.json": JSON.stringify(DEFAULT_PKG), "src/clean.js": "const x = 1;\n" },
    async (dir) => {
      const report = await buildScanReport(dir, [outdated({})]);
      const det = report.detections[0];
      // zod's codemods are known for this upgrade path...
      assert.ok(det.changes.length > 0);
      // ...but none of them appear in this codebase.
      assert.equal(det.filesMatched, 0);
      assert.equal(det.locationsMatched, 0);
      assert.equal(det.displayedImpact, false);
      // Status stays "ok": we *know* the breaking changes, they just don't apply.
      assert.equal(det.status, "ok");
    },
  );
});

test("buildScanReport: aggregates a multi-dependency summary", async () => {
  await withScanEnv(
    {
      "package.json": JSON.stringify(DEFAULT_PKG),
      "src/a.js": "r.error.errors;\n",
      "src/b.js": "<Switch>\n",
    },
    async (dir) => {
      const report = await buildScanReport(dir, [
        outdated({}),
        outdated({ name: "react-router-dom", current: "5.3.4", latest: "6.30.0" }),
        outdated({ name: "left-pad", current: "1.0.0", latest: "2.0.0" }),
      ]);

      assert.equal(report.summary.depsScanned, 3);
      assert.equal(report.summary.depsWithKnownBreaking, 2); // zod + react-router-dom
      assert.equal(report.summary.filesAffected, 2);
      assert.equal(report.summary.locationsAffected, 2);
      assert.equal(report.detections.length, 3);
    },
  );
});

test("buildScanReport: lists file creations for a scaffolding codemod", async () => {
  await withScanEnv(
    { "package.json": JSON.stringify(DEFAULT_PKG), ".eslintrc.js": "module.exports = {};\n" },
    async (dir) => {
      const report = await buildScanReport(dir, [
        outdated({ name: "eslint", current: "8.57.0", latest: "9.0.0" }),
      ]);
      const det = report.detections[0];
      assert.ok(det.fileCreations?.some((f) => f.path === "eslint.config.js"));
    },
  );
});

test("buildScanReport: workspace path is carried through to the detection", async () => {
  await withScanEnv(
    { "package.json": JSON.stringify(DEFAULT_PKG), "src/a.js": "r.error.errors;\n" },
    async (dir) => {
      const report = await buildScanReport(dir, [outdated({ workspacePath: "packages/api" })]);
      assert.equal(report.detections[0].workspacePath, "packages/api");
    },
  );
});

test("buildScanReport: empty outdated list produces an empty, well-formed report", async () => {
  await withScanEnv({ "package.json": JSON.stringify(DEFAULT_PKG) }, async (dir) => {
    const report = await buildScanReport(dir, []);
    assert.equal(report.summary.depsScanned, 0);
    assert.equal(report.summary.filesAffected, 0);
    assert.deepEqual(report.detections, []);
  });
});