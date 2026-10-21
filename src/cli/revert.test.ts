import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "../engine/exec.js";
import { revertDependency } from "./revert.js";

/** A real git repo with a greenbump-style bump commit on top of an initial commit. */
async function withBumpRepo(
  fn: (dir: string, bumpSha: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-revert-"));
  const git = (args: string[]) => exec("git", args, { cwd: dir, timeout: 30_000 });
  try {
    await git(["init"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "test"]);
    await git(["config", "commit.gpgsign", "false"]);

    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "4.17.20" } }), "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-m", "initial"]);

    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "4.17.21" } }), "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-m", "chore(deps): bump lodash 4.17.20 → 4.17.21\n\nAutomated by greenbump."]);

    const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();
    await fn(dir, sha);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("revertDependency: reverts the greenbump bump onto its own branch", async () => {
  await withBumpRepo(async (dir, sha) => {
    const result = await revertDependency(dir, "lodash");
    assert.equal(result.ok, true, result.message);
    assert.match(result.branch!, /^greenbump\/revert-lodash-/);
    assert.equal(result.sha, sha);

    const branch = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir })).stdout.trim();
    assert.equal(branch, result.branch);

    const pkg = JSON.parse(
      (await exec("git", ["show", "HEAD:package.json"], { cwd: dir })).stdout,
    ) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies.lodash, "4.17.20", "revert should restore the previous version");
  });
});

test("revertDependency: refuses when no bump commit exists for that dependency", async () => {
  await withBumpRepo(async (dir) => {
    const result = await revertDependency(dir, "react");
    assert.equal(result.ok, false);
    assert.match(result.message, /no greenbump bump commit found/);
    assert.match(result.message, /--to <previous-version>/);
  });
});

test("revertDependency: refuses on a dirty working tree", async () => {
  await withBumpRepo(async (dir) => {
    await writeFile(join(dir, "scratch.txt"), "uncommitted", "utf8");
    const result = await revertDependency(dir, "lodash");
    assert.equal(result.ok, false);
    assert.match(result.message, /working tree is dirty/);
  });
});

test("revertDependency: reports a non-git directory instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-nogit-"));
  try {
    const result = await revertDependency(dir, "lodash");
    assert.equal(result.ok, false);
    assert.match(result.message, /not a git repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});