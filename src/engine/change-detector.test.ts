import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./exec.js";
import { detectSuspiciousChanges } from "./change-detector.js";

async function withRepo(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-changedet-"));
  try {
    await exec("git", ["init", "-q"], { cwd: dir });
    await exec("git", ["config", "user.email", "test@greenbump.dev"], { cwd: dir });
    await exec("git", ["config", "user.name", "greenbump test"], { cwd: dir });
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(dir, path.split("/").slice(0, -1).join("/")), { recursive: true }).catch(() => {});
      await writeFile(join(dir, path), content, "utf8");
    }
    await exec("git", ["add", "-A"], { cwd: dir });
    await exec("git", ["commit", "-q", "-m", "init", "--no-verify"], { cwd: dir });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("change-detector: removed test cases are reported per file, not just for the last one", async () => {
  await withRepo(
    {
      "a.test.js": "it('one', () => {});\nit('two', () => {});\n",
      "b.test.js": "test('three', () => {});\n",
    },
    async (dir) => {
      // The "LLM cheated" scenario: delete test cases from BOTH files.
      await writeFile(join(dir, "a.test.js"), "it('one', () => {});\n", "utf8");
      await writeFile(join(dir, "b.test.js"), "", "utf8");

      const changes = await detectSuspiciousChanges(dir);
      const removed = changes.filter((c) => c.type === "test-removed");

      assert.equal(removed.length, 2);
      assert.deepEqual(
        removed.map((c) => c.file).sort(),
        ["a.test.js", "b.test.js"],
      );
      assert.ok(removed.every((c) => c.severity === "critical"));
    },
  );
});

test("change-detector: modifying a test file is flagged critical", async () => {
  await withRepo({ "src/app.test.ts": "it('x', () => {});\n" }, async (dir) => {
    await writeFile(join(dir, "src/app.test.ts"), "it('x changed', () => {});\n", "utf8");
    const changes = await detectSuspiciousChanges(dir);
    assert.ok(changes.some((c) => c.type === "test-modified" && c.file === "src/app.test.ts"));
  });
});

test("change-detector: clean source-only edit produces no critical findings", async () => {
  await withRepo({ "src/app.ts": "export const a = 1;\n" }, async (dir) => {
    await writeFile(join(dir, "src/app.ts"), "export const a = 2;\n", "utf8");
    const changes = await detectSuspiciousChanges(dir);
    assert.equal(changes.filter((c) => c.severity === "critical").length, 0);
  });
});

test("change-detector: newly created untracked test file is flagged as suspicious", async () => {
  await withRepo({ "src/app.ts": "export const x = 1;\n" }, async (dir) => {
    await writeFile(join(dir, "new-fake.test.ts"), "it('dummy', () => {});\n", "utf8");
    const changes = await detectSuspiciousChanges(dir);
    assert.ok(changes.some((c) => c.type === "test-modified" && c.file === "new-fake.test.ts"));
  });
});

test("change-detector: not a git repo returns [] instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-changedet-"));
  try {
    const changes = await detectSuspiciousChanges(dir);
    assert.deepEqual(changes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
