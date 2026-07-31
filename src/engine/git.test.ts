import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./exec.js";
import {
  isGitRepo,
  isTreeClean,
  currentBranch,
  createBranch,
  checkout,
  commitAll,
  diffStat,
  fullDiff,
  changedFiles,
} from "./git.js";

async function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-git-"));
  try {
    await exec("git", ["init", "-q"], { cwd: dir });
    // Never touch the machine's global git config — set identity locally only.
    await exec("git", ["config", "user.email", "test@greenbump.dev"], { cwd: dir });
    await exec("git", ["config", "user.name", "greenbump test"], { cwd: dir });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Repo with one committed file, so HEAD is a real ref (not "unborn"). */
async function withInitializedRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  await withRepo(async (dir) => {
    await writeFile(join(dir, "README.md"), "hello\n", "utf8");
    await exec("git", ["add", "-A"], { cwd: dir });
    await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await fn(dir);
  });
}

test("isGitRepo: true inside a git repo, false in a plain directory", async () => {
  await withRepo(async (dir) => {
    assert.equal(await isGitRepo(dir), true);
  });
  const plain = await mkdtemp(join(tmpdir(), "greenbump-plain-"));
  try {
    assert.equal(await isGitRepo(plain), false);
  } finally {
    await rm(plain, { recursive: true, force: true });
  }
});

test("isTreeClean: true right after commit, false with an untracked or modified file", async () => {
  await withInitializedRepo(async (dir) => {
    assert.equal(await isTreeClean(dir), true);

    await writeFile(join(dir, "untracked.txt"), "x", "utf8");
    assert.equal(await isTreeClean(dir), false);

    await exec("git", ["add", "-A"], { cwd: dir });
    await exec("git", ["commit", "-q", "-m", "add untracked"], { cwd: dir });
    assert.equal(await isTreeClean(dir), true);

    await appendFile(join(dir, "README.md"), "more\n");
    assert.equal(await isTreeClean(dir), false);
  });
});

test("currentBranch + createBranch: creates and switches to a new branch", async () => {
  await withInitializedRepo(async (dir) => {
    const before = await currentBranch(dir);
    assert.ok(before.length > 0);

    await createBranch(dir, "greenbump/lodash-4.17.21");
    const after = await currentBranch(dir);
    assert.equal(after, "greenbump/lodash-4.17.21");
    assert.notEqual(after, before);
  });
});

test("checkout: switches HEAD back to an existing branch", async () => {
  await withInitializedRepo(async (dir) => {
    const original = await currentBranch(dir);
    await createBranch(dir, "feature-x");
    assert.equal(await currentBranch(dir), "feature-x");

    await checkout(dir, original);
    assert.equal(await currentBranch(dir), original);
  });
});

test("commitAll: stages and commits pending changes, including untracked files", async () => {
  await withInitializedRepo(async (dir) => {
    await writeFile(join(dir, "new-file.txt"), "content", "utf8");
    await appendFile(join(dir, "README.md"), "more\n");
    assert.equal(await isTreeClean(dir), false);

    await commitAll(dir, "chore(deps): bump lodash 4.17.20 → 4.17.21");

    assert.equal(await isTreeClean(dir), true);
    const log = await exec("git", ["log", "-1", "--pretty=%s"], { cwd: dir });
    assert.equal(log.stdout.trim(), "chore(deps): bump lodash 4.17.20 → 4.17.21");
  });
});

test("diffStat + fullDiff + changedFiles: report changes made since a ref", async () => {
  await withInitializedRepo(async (dir) => {
    const base = (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();

    await writeFile(join(dir, "src.js"), "export const x = 1;\n", "utf8");
    await appendFile(join(dir, "README.md"), "changed\n");
    await commitAll(dir, "add src.js and edit README");

    const files = await changedFiles(dir, base);
    assert.deepEqual([...files].sort(), ["README.md", "src.js"]);

    const stat = await diffStat(dir, base);
    assert.match(stat, /README\.md/);
    assert.match(stat, /src\.js/);

    const diff = await fullDiff(dir, base);
    assert.match(diff, /\+export const x = 1;/);
    assert.match(diff, /\+changed/);
  });
});

test("commitAll: --no-verify means a failing pre-commit hook does not block the commit", async () => {
  await withInitializedRepo(async (dir) => {
    const hooksDir = join(dir, ".git", "hooks");
    await writeFile(
      join(hooksDir, "pre-commit"),
      "#!/bin/sh\nexit 1\n",
      { mode: 0o755 },
    );

    await writeFile(join(dir, "another.txt"), "x", "utf8");
    await commitAll(dir, "should succeed despite failing hook");

    assert.equal(await isTreeClean(dir), true);
    const log = await exec("git", ["log", "-1", "--pretty=%s"], { cwd: dir });
    assert.equal(log.stdout.trim(), "should succeed despite failing hook");
  });
});
