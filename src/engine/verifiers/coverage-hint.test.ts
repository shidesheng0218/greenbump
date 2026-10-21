import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { findUnreferencedEdits } from "./coverage-hint.js";

async function withProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-cov-"));
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

test("findUnreferencedEdits: flags an edited file no test imports", async () => {
  await withProject(
    {
      "src/a.ts": "export const a = 1;",
      "src/b.ts": "export const b = 2;",
      "test/a.test.ts": 'import { a } from "../src/a";',
    },
    async (dir) => {
      const result = await findUnreferencedEdits(dir, ["src/a.ts", "src/b.ts"]);
      assert.deepEqual(result, ["src/b.ts"]);
    },
  );
});

test("findUnreferencedEdits: a referenced file is not flagged", async () => {
  await withProject(
    { "src/a.ts": "export const a = 1;", "test/a.test.ts": 'import { a } from "../src/a";' },
    async (dir) => {
      assert.deepEqual(await findUnreferencedEdits(dir, ["src/a.ts"]), []);
    },
  );
});

test("findUnreferencedEdits: recognizes require() as a reference", async () => {
  await withProject(
    { "src/a.js": "module.exports = 1;", "test/a.test.js": 'const a = require("../src/a");' },
    async (dir) => {
      assert.deepEqual(await findUnreferencedEdits(dir, ["src/a.js"]), []);
    },
  );
});

test("findUnreferencedEdits: edited test files are never reported", async () => {
  await withProject(
    { "test/a.test.ts": "test('x', () => {})", "src/a.ts": "export const a = 1;" },
    async (dir) => {
      assert.deepEqual(await findUnreferencedEdits(dir, ["test/a.test.ts"]), []);
    },
  );
});

test("findUnreferencedEdits: no test files at all yields no warnings", async () => {
  // "no tests" is reported separately as `unverifiable` — warning here would
  // just be noise on every project without a suite.
  await withProject({ "src/a.ts": "export const a = 1;" }, async (dir) => {
    assert.deepEqual(await findUnreferencedEdits(dir, ["src/a.ts"]), []);
  });
});

test("findUnreferencedEdits: non-source edits are ignored", async () => {
  await withProject(
    { "README.md": "# hi", "test/a.test.ts": "test('x', () => {})" },
    async (dir) => {
      assert.deepEqual(await findUnreferencedEdits(dir, ["README.md"]), []);
    },
  );
});

test("findUnreferencedEdits: node_modules is not scanned for tests", async () => {
  await withProject(
    {
      "src/a.ts": "export const a = 1;",
      "node_modules/pkg/a.test.ts": 'import { a } from "../../src/a";',
    },
    async (dir) => {
      // The only "test" lives in node_modules, so it must not count as coverage.
      assert.deepEqual(await findUnreferencedEdits(dir, ["src/a.ts"]), []);
    },
  );
});