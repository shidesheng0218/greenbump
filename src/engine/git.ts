import { exec } from "./exec.js";

export { exec };

/** Default ceiling for git ops — a hanging credential/GPG prompt must not hang a run. */
const GIT_TIMEOUT_MS = 30_000;

/** Throw on a failed git mutation, including the stderr that explains why. */
function assertOk(r: { code: number; stderr: string }, what: string): void {
  if (r.code !== 0) {
    throw new Error(`git ${what} failed (exit ${r.code}): ${r.stderr.trim() || "no stderr"}`);
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: GIT_TIMEOUT_MS });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function isTreeClean(cwd: string): Promise<boolean> {
  const r = await exec("git", ["status", "--porcelain"], { cwd, timeout: GIT_TIMEOUT_MS });
  return r.code === 0 && r.stdout.trim() === "";
}

export async function currentBranch(cwd: string): Promise<string> {
  const r = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: GIT_TIMEOUT_MS });
  return r.stdout.trim();
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  assertOk(await exec("git", ["checkout", "-b", name], { cwd, timeout: GIT_TIMEOUT_MS }), `checkout -b ${name}`);
}

/**
 * Add a temporary git worktree with a newly created branch.
 * Allows operations to run physically isolated from the user's primary working tree.
 */
export async function addWorktree(cwd: string, worktreePath: string, branch: string): Promise<void> {
  assertOk(
    await exec("git", ["worktree", "add", "-b", branch, worktreePath], { cwd, timeout: GIT_TIMEOUT_MS }),
    `worktree add -b ${branch}`,
  );
}

/**
 * Remove a git worktree and prune.
 */
export async function removeWorktree(cwd: string, worktreePath: string, force: boolean = false): Promise<void> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreePath);
  await exec("git", args, { cwd, timeout: GIT_TIMEOUT_MS });
  await exec("git", ["worktree", "prune"], { cwd, timeout: GIT_TIMEOUT_MS });
}

export async function checkout(cwd: string, ref: string): Promise<void> {
  assertOk(await exec("git", ["checkout", ref], { cwd, timeout: GIT_TIMEOUT_MS }), `checkout ${ref}`);
}

/** Discard ALL uncommitted state (tracked + untracked). Used between batch targets. */
export async function resetHard(cwd: string): Promise<void> {
  assertOk(await exec("git", ["reset", "--hard"], { cwd, timeout: GIT_TIMEOUT_MS }), "reset --hard");
  assertOk(await exec("git", ["clean", "-fd"], { cwd, timeout: GIT_TIMEOUT_MS }), "clean -fd");
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  assertOk(await exec("git", ["add", "-A"], { cwd, timeout: GIT_TIMEOUT_MS }), "add -A");
  assertOk(
    await exec("git", ["commit", "-m", message, "--no-verify"], { cwd, timeout: GIT_TIMEOUT_MS }),
    "commit",
  );
}

/** `git diff --stat` against a ref, for the PR summary. */
export async function diffStat(cwd: string, ref: string): Promise<string> {
  const r = await exec("git", ["diff", "--stat", ref], { cwd });
  return r.stdout.trim();
}

/** Full unified diff against a ref, for the PR body. */
export async function fullDiff(cwd: string, ref: string): Promise<string> {
  const r = await exec("git", ["diff", ref], { cwd });
  return r.stdout;
}

/** List files changed since a ref. */
export async function changedFiles(cwd: string, ref: string): Promise<string[]> {
  const r = await exec("git", ["diff", "--name-only", ref], { cwd });
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
