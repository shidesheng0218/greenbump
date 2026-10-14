import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { scanOnce } from "./indexer.js";
import { REQUIRES_IMPORT_PREFIX, type Probe } from "./probes.js";

async function withProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-scan-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
  }
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function probe(pattern: string, key = "k0", fileFilter?: string): Probe {
  return { key, pattern, refs: [{ depName: "pkg", changeIndex: 0 }], ...(fileFilter ? { fileFilter } : {}) };
}

test("scanOnce: reports file and 1-based line for each match", async () => {
  await withProject(
    { "src/a.js": "line one\noldApi()\nline three\n" },
    async (dir) => {
      const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].file, join("src", "a.js"));
      assert.equal(hits[0].line, 2);
      assert.equal(hits[0].excerpt, "oldApi()");
    },
  );
});

test("scanOnce: finds multiple matches across files", async () => {
  await withProject(
    {
      "src/a.js": "oldApi()\n",
      "src/nested/b.ts": "const x = oldApi;\n",
    },
    async (dir) => {
      const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
      const files = hits.map((h) => h.file).sort();
      assert.deepEqual(files, [join("src", "a.js"), join("src", "nested", "b.ts")]);
    },
  );
});

test("scanOnce: counts every occurrence on one line", async () => {
  await withProject({ "a.js": "oldApi(); oldApi();\n" }, async (dir) => {
    const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
    assert.equal(hits.length, 2);
  });
});

test("scanOnce: caps matches per probe and flags the probe as truncated", async () => {
  const manyLines = Array.from({ length: 50 }, () => "oldApi();").join("\n");
  await withProject({ "a.js": manyLines }, async (dir) => {
    const { hits, truncatedProbes } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 10 });
    assert.equal(hits.length, 10);
    assert.ok(truncatedProbes.has("k0"));
  });
});

test("scanOnce: a probe under its cap is not marked truncated", async () => {
  await withProject({ "a.js": "oldApi();\n" }, async (dir) => {
    const { truncatedProbes } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 10 });
    assert.equal(truncatedProbes.size, 0);
  });
});

test("scanOnce: matches are attributed to the right probe when several are active", async () => {
  await withProject({ "a.js": "alpha();\nbeta();\n" }, async (dir) => {
    const { hits } = await scanOnce(
      dir,
      [probe("alpha", "k-alpha"), probe("beta", "k-beta")],
      { perProbeCap: 200 },
    );
    assert.equal(hits.length, 2);
    const alpha = hits.find((h) => h.excerpt.startsWith("alpha"));
    const beta = hits.find((h) => h.excerpt.startsWith("beta"));
    assert.equal(alpha?.probeKey, "k-alpha");
    assert.equal(beta?.probeKey, "k-beta");
  });
});

test("scanOnce: skips node_modules and other ignored directories", async () => {
  await withProject(
    {
      "src/a.js": "oldApi();\n",
      "node_modules/dep/index.js": "oldApi();\n",
      "dist/bundle.js": "oldApi();\n",
    },
    async (dir) => {
      const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].file, join("src", "a.js"));
    },
  );
});

test("scanOnce: never reports matches from secrets files", async () => {
  await withProject(
    {
      "src/a.js": "oldApi();\n",
      ".env": "SECRET=oldApi\n",
      "secrets.json": '{"k":"oldApi"}\n',
      "credentials.json": '{"k":"oldApi"}\n',
    },
    async (dir) => {
      const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].file, join("src", "a.js"));
    },
  );
});

test("scanOnce: only searches known source extensions", async () => {
  await withProject(
    { "a.js": "oldApi();\n", "notes.txt": "oldApi();\n", "image.bin": "oldApi();\n" },
    async (dir) => {
      const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
      assert.deepEqual(hits.map((h) => h.file), ["a.js"]);
    },
  );
});

test("scanOnce: fileFilter restricts matches to matching paths", async () => {
  await withProject(
    { "src/a.js": "oldApi();\n", "test/b.js": "oldApi();\n" },
    async (dir) => {
      const { hits } = await scanOnce(dir, [probe("oldApi", "k0", "test")], { perProbeCap: 200 });
      assert.deepEqual(hits.map((h) => h.file), [join("test", "b.js")]);
    },
  );
});

test("scanOnce: import gate limits bare-identifier probes to importing files", async () => {
  await withProject(
    {
      "imports.js": "const { describe } = require('vitest');\ndescribe('x', () => {});\n",
      "unrelated.js": "describe('this is not vitest');\n",
    },
    async (dir) => {
      const { hits } = await scanOnce(
        dir,
        [probe("describe", "k0", `${REQUIRES_IMPORT_PREFIX}vitest`)],
        { perProbeCap: 200 },
      );
      // Both occurrences live in imports.js; unrelated.js must contribute none.
      assert.deepEqual(hits.map((h) => h.file), ["imports.js", "imports.js"]);
      assert.deepEqual(hits.map((h) => h.line), [1, 2]);
    },
  );
});

test("scanOnce: import gate also matches ESM import statements", async () => {
  await withProject(
    {
      "esm.mjs": 'import { describe } from "vitest";\ndescribe("x");\n',
      "other.mjs": 'describe("nope");\n',
    },
    async (dir) => {
      const { hits } = await scanOnce(
        dir,
        [probe("describe", "k0", `${REQUIRES_IMPORT_PREFIX}vitest`)],
        { perProbeCap: 200 },
      );
      assert.ok(hits.every((h) => h.file === "esm.mjs"));
      assert.equal(hits.length, 2);
    },
  );
});

test("scanOnce: an invalid regex falls back to a literal match instead of throwing", async () => {
  await withProject({ "a.js": "a[b\n" }, async (dir) => {
    // Unbalanced bracket is not a valid regex — must not throw.
    const { hits } = await scanOnce(dir, [probe("a[b")], { perProbeCap: 200 });
    assert.equal(hits.length, 1);
  });
});

test("scanOnce: no probes means no hits (and no crash)", async () => {
  await withProject({ "a.js": "anything\n" }, async (dir) => {
    const { hits, truncatedProbes } = await scanOnce(dir, [], { perProbeCap: 200 });
    assert.deepEqual(hits, []);
    assert.equal(truncatedProbes.size, 0);
  });
});

test("scanOnce: empty directory yields no hits", async () => {
  await withProject({}, async (dir) => {
    const { hits } = await scanOnce(dir, [probe("oldApi")], { perProbeCap: 200 });
    assert.deepEqual(hits, []);
  });
});