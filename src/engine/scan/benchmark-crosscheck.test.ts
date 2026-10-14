import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScanReport } from "./impact.js";
import { WORKSPACE_ROOT, type WorkspaceOutdated } from "../workspace.js";
import { resetCacheForTests } from "../cache/manager.js";

/**
 * Cross-check: `--scan` must predict exactly the breakages the fix loop
 * already knows how to fix.
 *
 * Each benchmark case under benchmarks/cases/ ships a real fixture repo plus
 * an `expect.json` whose `forbiddenPatterns` describe the breakage present
 * BEFORE the fix (and required absent after). If scan's deterministic
 * prediction can't find those same patterns in the fixture, then either the
 * codemod registry or the scan probe logic has drifted — the user would be
 * told "no impact" for an upgrade greenbump would actually have to fix.
 */

const CASES_DIR = fileURLToPath(new URL("../../../benchmarks/cases", import.meta.url));

interface BenchCase {
  name: string;
  dep: string;
  from: string;
  to: string;
  ecosystem: string;
  expectedTier?: number;
}

interface BenchExpect {
  forbiddenPatterns?: string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Every fixture that ships a case.json + expect.json with forbidden patterns. */
async function loadCases(): Promise<Array<{ dir: string; meta: BenchCase; expect: BenchExpect }>> {
  const entries = await readdir(CASES_DIR, { withFileTypes: true });
  const cases: Array<{ dir: string; meta: BenchCase; expect: BenchExpect }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(CASES_DIR, e.name, "repo");
    if (!(await exists(dir))) continue;
    const meta = JSON.parse(await readFile(join(CASES_DIR, e.name, "case.json"), "utf8")) as BenchCase;
    const exp = JSON.parse(await readFile(join(CASES_DIR, e.name, "expect.json"), "utf8")) as BenchExpect;
    if (!exp.forbiddenPatterns || exp.forbiddenPatterns.length === 0) continue;
    cases.push({ dir, meta, expect: exp });
  }
  return cases;
}

function asOutdated(meta: BenchCase): WorkspaceOutdated {
  return {
    name: meta.dep,
    current: meta.from,
    wanted: meta.from,
    latest: meta.to,
    workspacePath: WORKSPACE_ROOT,
  };
}

/**
 * Run `fn` with an empty, isolated cache dir so the codemod registry is the
 * only possible source of scan results. Uses a real temp dir — pointing at a
 * path under the repo would have the cache manager create it.
 */
async function withEmptyCache(fn: () => Promise<void>): Promise<void> {
  const cacheDir = await mkdtemp(join(tmpdir(), "greenbump-crosscheck-cache-"));
  const prevCache = process.env.GREENBUMP_CACHE_DIR;
  process.env.GREENBUMP_CACHE_DIR = cacheDir;
  resetCacheForTests();
  try {
    await fn();
  } finally {
    if (prevCache === undefined) delete process.env.GREENBUMP_CACHE_DIR;
    else process.env.GREENBUMP_CACHE_DIR = prevCache;
    resetCacheForTests();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

test("scan cross-check: finds the benchmark fixtures", async () => {
  const cases = await loadCases();
  assert.ok(cases.length >= 5, `expected at least 5 fixtures, found ${cases.length}`);
});

test("scan cross-check: every tier-1 fixture's breakage is predicted from codemods alone", async () => {
  const cases = await loadCases();
  const tier1 = cases.filter((c) => c.meta.expectedTier === 1);
  assert.ok(tier1.length > 0, "expected at least one tier-1 fixture");

  await withEmptyCache(async () => {
    for (const { dir, meta, expect } of tier1) {
      const report = await buildScanReport(dir, [asOutdated(meta)]);
      const det = report.detections[0];

      assert.equal(det.status, "ok", `${meta.name}: scan did not recognise this upgrade`);
      assert.ok(
        det.locationsMatched >= 1,
        `${meta.name}: scan found no impact, but this fixture is a known tier-1 breakage`,
      );

      // At least one predicted location must actually carry the breakage the
      // benchmark says is present in the fixture.
      const excerpts = det.changes.flatMap((c) => c.fileGroups.flatMap((g) => g.locations.map((l) => l.excerpt)));
      const hit = expect.forbiddenPatterns!.some((re) =>
        excerpts.some((line) => new RegExp(re).test(line)),
      );
      assert.ok(
        hit,
        `${meta.name}: none of the ${expect.forbiddenPatterns!.join(", ")} patterns appeared in scan output:\n` +
          excerpts.map((e) => `  ${e}`).join("\n"),
      );
    }
  });
});

test("scan cross-check: without a cache, an uncovered upgrade is reported unknown rather than guessed", async () => {
  // A dependency with no built-in codemod and no cached digest must not
  // invent an impact result — it reports "unknown" and nothing else.
  await withEmptyCache(async () => {
    const dir = join(CASES_DIR, "zod-3-to-4-issues", "repo");
    const report = await buildScanReport(dir, [
      { name: "some-unmapped-package", current: "1.0.0", wanted: "1.0.0", latest: "2.0.0", workspacePath: WORKSPACE_ROOT },
    ]);
    assert.equal(report.detections[0].status, "unknown");
    assert.deepEqual(report.detections[0].changes, []);
    assert.equal(report.summary.depsWithKnownBreaking, 0);
  });
});