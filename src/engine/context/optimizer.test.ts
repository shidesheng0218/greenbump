import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  trimFailureOutput,
  extractCandidateFiles,
  estimateTokens,
  buildCandidateHint,
} from "./optimizer.js";

test("trimFailureOutput: drops passing-test noise, keeps errors", () => {
  const output = [
    "  ✓ renders header",
    "  ✓ renders footer",
    "  ✗ renders body",
    "TypeError: ReactDOM.render is not a function",
    "    at render (src/index.tsx:5:3)",
    "    at Object.<anonymous> (node_modules/react-dom/cjs/index.js:12:1)",
    "Tests: 2 passed, 1 failed",
  ].join("\n");

  const trimmed = trimFailureOutput(output);
  assert.ok(trimmed.includes("ReactDOM.render is not a function"));
  assert.ok(!trimmed.includes("✓ renders header"));
  assert.ok(!trimmed.includes("node_modules"));
  assert.ok(!trimmed.includes("Tests: 2 passed"));
});

test("trimFailureOutput: caps total size", () => {
  const huge = "error line\n".repeat(5000);
  const trimmed = trimFailureOutput(huge);
  assert.ok(trimmed.length < 5000);
});

test("extractCandidateFiles: pulls project-relative paths from TS errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ctx-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "index.tsx"), "content", "utf8");
  try {
    const files = await extractCandidateFiles(
      "src/index.tsx:5:3 - error TS2339: Property 'render' does not exist",
      dir,
    );
    assert.deepEqual(files, ["src/index.tsx"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractCandidateFiles: ignores node_modules and absolute paths outside project", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ctx-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "index.tsx"), "content", "utf8");
  try {
    const files = await extractCandidateFiles(
      [
        "at render (/project/node_modules/react-dom/index.js:5:3)",
        "at render (/totally/other/place/file.ts:1:1)",
        "src/index.tsx:5:3 - error TS2339",
      ].join("\n"),
      dir,
    );
    assert.deepEqual(files, ["src/index.tsx"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractCandidateFiles: only returns files that exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ctx-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "real.tsx"), "content", "utf8");
  try {
    const files = await extractCandidateFiles(
      ["src/real.tsx:1:1 - error", "src/imaginary.tsx:2:2 - error"].join("\n"),
      dir,
    );
    assert.deepEqual(files, ["src/real.tsx"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("estimateTokens: roughly 4 chars per token", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(100)), 25);
});

test("buildCandidateHint: empty when no candidates", () => {
  assert.equal(buildCandidateHint([], []), "");
});

test("buildCandidateHint: lists files and tests", () => {
  const hint = buildCandidateHint(["src/index.tsx"], ["src/index.test.tsx"]);
  assert.ok(hint.includes("src/index.tsx"));
  assert.ok(hint.includes("src/index.test.tsx"));
});
