import {
  isGitRepo,
  isTreeClean,
  currentBranch,
  createBranch,
  findCommitByMessage,
  revertCommit,
} from "../engine/git.js";

/**
 * `--revert <dep>`: undo the bump greenbump made, as a normal revert commit on
 * its own branch.
 *
 * This exists for the case the tool cannot prevent: the PR was merged, CI was
 * green, and production still broke. Rather than making the user hunt through
 * git history, find the greenbump bump commit and revert it.
 */

export interface RevertResult {
  ok: boolean;
  message: string;
  branch?: string;
  sha?: string;
}

export async function revertDependency(cwd: string, dep: string): Promise<RevertResult> {
  if (!(await isGitRepo(cwd))) {
    return { ok: false, message: "not a git repository — nothing to revert" };
  }
  if (!(await isTreeClean(cwd))) {
    return {
      ok: false,
      message: "working tree is dirty — commit or stash first, so the revert can be undone cleanly",
    };
  }

  // commitAll() writes "chore(deps): bump <dep> <from> → <to>"; matching on the
  // stable prefix keeps this working regardless of how the versions rendered.
  const commit = await findCommitByMessage(cwd, `chore(deps): bump ${dep} `);
  if (!commit) {
    return {
      ok: false,
      message:
        `no greenbump bump commit found for \`${dep}\`.\n` +
        `  If the upgrade was made another way, pin it back explicitly: greenbump ${dep} --to <previous-version>`,
    };
  }

  const base = await currentBranch(cwd);
  const branch = `greenbump/revert-${dep.replace(/[^a-zA-Z0-9._-]/g, "-")}-${commit.sha.slice(0, 7)}`;
  await createBranch(cwd, branch);

  const result = await revertCommit(cwd, commit.sha);
  if (!result.ok) {
    return {
      ok: false,
      branch,
      sha: commit.sha,
      message:
        `revert of ${commit.sha.slice(0, 7)} ("${commit.subject}") hit conflicts.\n` +
        `  Resolve them, or undo with: git revert --abort && git checkout ${base} && git branch -D ${branch}\n` +
        result.output.trim(),
    };
  }

  return {
    ok: true,
    branch,
    sha: commit.sha,
    message:
      `reverted ${commit.sha.slice(0, 7)} ("${commit.subject}") on branch ${branch}.\n` +
      `  Review with: git show HEAD\n  Return with: git checkout ${base}`,
  };
}