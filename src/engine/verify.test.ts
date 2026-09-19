import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectEslintConfig } from "./verify.js";

async function withDir(files: string[], fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-verify-"));
  for (const f of files) await writeFile(join(dir, f), "{}", "utf8");
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("detectEslintConfig: recognizes ESLint 9 flat config", async () => {
  await withDir(["eslint.config.js"], async (dir) => {
    assert.deepEqual(await detectEslintConfig(dir), { kind: "flat" });
  });
  await withDir(["eslint.config.mjs"], async (dir) => {
    assert.deepEqual(await detectEslintConfig(dir), { kind: "flat" });
  });
});

test("detectEslintConfig: recognizes legacy eslintrc variants", async () => {
  await withDir([".eslintrc.json"], async (dir) => {
    assert.deepEqual(await detectEslintConfig(dir), { kind: "legacy" });
  });
  await withDir([".eslintrc"], async (dir) => {
    assert.deepEqual(await detectEslintConfig(dir), { kind: "legacy" });
  });
});

test("detectEslintConfig: package.json eslintConfig field counts as legacy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-verify-"));
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ eslintConfig: {} }), "utf8");
    assert.deepEqual(await detectEslintConfig(dir), { kind: "legacy" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectEslintConfig: no config returns null", async () => {
  await withDir(["index.js"], async (dir) => {
    assert.equal(await detectEslintConfig(dir), null);
  });
});
