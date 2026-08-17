import { exec } from "./exec.js";

export { exec };

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function isTreeClean(cwd: string): Promise<boolean> {
  const r = await exec("git", ["status", "--porcelain"], { cwd });
  return r.code === 0 && r.stdout.trim() === "";
}

export async function currentBranch(cwd: string): Promise<string> {
  const r = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return r.stdout.trim();
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  await exec("git", ["checkout", "-b", name], { cwd });
}

export async function checkout(cwd: string, ref: string): Promise<void> {
  await exec("git", ["checkout", ref], { cwd });
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  await exec("git", ["add", "-A"], { cwd });
  await exec("git", ["commit", "-m", message, "--no-verify"], { cwd });
}

/**
 * Create an incremental commit for a specific stage of the fix process.
 * Used in staged fix mode to create separate commits for each stage.
 */
export async function commitStage(
  cwd: string,
  stageName: string,
  stageNumber: number,
  totalStages: number
): Promise<void> {
  await exec("git", ["add", "-A"], { cwd });
  const message = `fix: stage ${stageNumber}/${totalStages} - ${stageName}\n\nAutomated by greenbump (staged fix mode).`;
  await exec("git", ["commit", "-m", message, "--no-verify"], { cwd });
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
