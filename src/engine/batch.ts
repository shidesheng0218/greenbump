import { run, RunError, computeNeedsReview, type RunOptions, type RunSummary, type RunFailure, type BatchItemResult } from "./run.js";
import { runChecks, type CheckOverrides } from "./checks.js";
import { upgradeDependency } from "./upgrade.js";
import { detectPackageManager } from "./pm.js";
import { fetchChangelog } from "./changelog.js";
import { isGitRepo, isTreeClean, currentBranch, createBranch, commitAll, diffStat, fullDiff, checkout } from "./git.js";
import { runFixLoop, type FixDep } from "../agent/fixer.js";
import { createProvider } from "../agent/factory.js";
import {
  detectOutdatedAll,
  resolveWorkspaceTarget,
  WORKSPACE_ROOT,
  type WorkspaceOutdated,
} from "./workspace.js";
import { join } from "node:path";

export interface UpgradeTarget {
  /** dependency name */
  dep: string;
  /** current version, as reported by outdated() */
  from?: string;
  /** explicit target version for this dep, else latest from outdated() */
  to?: string;
  /** workspace-relative subpath (WORKSPACE_ROOT for the repo root itself) */
  workspacePath?: string;
}

export interface BatchRunOptions extends Omit<RunOptions, "dep" | "to"> {
  /** true = upgrade every outdated dep found, across all workspaces if present */
  all?: boolean;
  /** explicit list of deps to upgrade (mutually exclusive with `all`) */
  deps?: string[];
  /** disambiguates which workspace package a named dep refers to, when ambiguous */
  workspace?: string;
  /** name for a combined branch/PR when deps.length > 1 and the user opted in to grouping */
  group?: string;
  /** abort the whole batch on the first hard failure instead of continuing; default false */
  failFast?: boolean;
}

export interface BatchRunSummary {
  results: BatchItemResult[];
}

/** `git checkout` back to the base ref, ignoring errors (best-effort cleanup between batch targets). */
async function checkoutBack(cwd: string, base: string): Promise<void> {
  await checkout(cwd, base);
}

function resolveCwd(cwd: string, workspacePath: string | undefined): string {
  if (!workspacePath || workspacePath === WORKSPACE_ROOT) return cwd;
  return join(cwd, workspacePath);
}

export async function runBatch(opts: BatchRunOptions): Promise<BatchRunSummary> {
  const { cwd } = opts;

  if (opts.all && opts.deps?.length) {
    throw new RunError("--all and an explicit dependency list are mutually exclusive.");
  }

  const pm = opts.ecosystem ?? (await detectPackageManager(cwd));
  const candidates = await detectOutdatedAll(pm, cwd);
  if (candidates.length === 0) {
    throw new RunError("No outdated dependencies found — nothing to upgrade.");
  }

  const targets = resolveTargets(opts, candidates);

  const baseBranch = (await isGitRepo(cwd)) && !opts.noGit ? await currentBranch(cwd) : undefined;

  const results: BatchItemResult[] = [];

  if (opts.group && targets.length > 1) {
    try {
      const summary = await runGrouped(opts, pm, targets, opts.group);
      results.push(summary);
    } catch (err) {
      if (opts.failFast) throw err;
      results.push({ dep: opts.group, error: (err as Error).message, fatal: true });
    }
    if (baseBranch) await checkoutBack(cwd, baseBranch);
    return { results };
  }

  for (const target of targets) {
    try {
      const summary = await run({
        ...stripBatchOnlyFields(opts),
        cwd: resolveCwd(cwd, target.workspacePath),
        dep: target.dep,
        to: target.to,
      });
      results.push(summary);
    } catch (err) {
      if (opts.failFast) throw err;
      results.push({ dep: target.dep, error: (err as Error).message, fatal: true });
    }
    if (baseBranch) await checkoutBack(cwd, baseBranch);
  }

  return { results };
}

/**
 * Grouped run: ONE branch, ONE baseline check, install all N targets
 * back-to-back, ONE post-upgrade check, ONE fix-loop call across all N
 * breakages, ONE commit. Mirrors run()'s body but widened to a target list —
 * see FixOptions.deps in fixer.ts for the multi-dep prompt this feeds.
 */
async function runGrouped(
  opts: BatchRunOptions,
  pm: string,
  targets: UpgradeTarget[],
  groupName: string,
): Promise<RunSummary> {
  const log = opts.onLog ?? (() => {});
  const startedAt = Date.now();
  const cwd = opts.cwd;

  const scopes = new Set(targets.map((t) => t.workspacePath ?? WORKSPACE_ROOT));
  if (scopes.size > 1) {
    throw new RunError(
      `--group targets must all live in the same workspace package; found: ${[...scopes].join(", ")}. ` +
        `Run each workspace's group separately.`,
    );
  }
  const groupCwd = resolveCwd(cwd, targets[0]?.workspacePath);

  const checkOverrides: CheckOverrides = { buildCmd: opts.buildCmd, testCmd: opts.testCmd };

  const resolvedTargets = targets.map((t) => {
    if (!t.to) throw new RunError(`\`${t.dep}\` has no resolved target version — internal error in resolveTargets().`);
    return { dep: t.dep, from: t.from ?? "", to: t.to };
  });

  let branch: string | undefined;
  const gitRepo = await isGitRepo(cwd);
  if (gitRepo && !opts.noGit) {
    if (!(await isTreeClean(cwd))) {
      throw new RunError("Working tree is dirty. Commit or stash your changes first (or pass --no-git).");
    }
    await currentBranch(cwd);
    branch = `greenbump/group-${groupName.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await createBranch(cwd, branch);
    log(`created branch ${branch}`);
  }

  log("running baseline build + tests…");
  const baseline = await runChecks(pm, groupCwd, checkOverrides);
  if (!baseline.ok && !baseline.unverifiable) {
    throw new RunError(
      `Baseline is already failing (${baseline.failedStep}) before any upgrade. ` +
        `Fix that first — greenbump can't tell your pre-existing failures from upgrade breakage.`,
    );
  }
  const baselineGreen = baseline.ok && !baseline.unverifiable;

  for (const target of resolvedTargets) {
    log(`installing ${target.dep}@${target.to}…`);
    const up = await upgradeDependency(pm, groupCwd, target.dep, target.to);
    if (!up.ok) {
      throw new RunError(`${pm} failed to install ${target.dep}@${target.to}:\n${up.output}`);
    }
  }

  const post = await runChecks(pm, groupCwd, checkOverrides);

  const depsSummary = resolvedTargets.map((t) => `${t.dep}→${t.to}`).join(", ");
  const summary: RunSummary = {
    dep: `group:${groupName}`,
    from: "",
    to: depsSummary,
    packageManager: pm,
    branch,
    baselineGreen,
    neededFix: false,
    fixed: post.ok,
    unverifiable: post.unverifiable,
    needsReview: false,
    committed: false,
    rounds: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    editedFiles: [],
    testFilesTouched: [],
    durationMs: 0,
  };

  if (post.unverifiable) {
    log("no build/test scripts — group upgrade applied but UNVERIFIED");
    summary.needsReview = true;
    await maybeCommitGroup(cwd, summary, depsSummary, true);
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  if (post.ok) {
    log("clean group upgrade — build + tests green with no code changes");
    await maybeCommitGroup(cwd, summary, depsSummary, true);
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  summary.neededFix = true;
  const deps: FixDep[] = [];
  for (const target of resolvedTargets) {
    const changelog = await fetchChangelog(target.dep, target.from, target.to);
    deps.push({ dep: target.dep, from: target.from, to: target.to, changelog });
  }

  const provider = createProvider({
    provider: opts.provider,
    model: opts.model,
    baseURL: opts.baseURL,
    apiKey: opts.apiKey,
  });
  log(`group upgrade broke ${post.failedStep} — starting fix loop via ${provider.name} (${provider.model})`);
  const fix = await runFixLoop({
    cwd: groupCwd,
    pm,
    checkOverrides,
    provider,
    maxRounds: opts.maxRounds,
    dep: deps[0]?.dep ?? groupName,
    from: deps[0]?.from ?? "",
    to: deps[0]?.to ?? "",
    deps,
    failureOutput: post.output,
    onLog: log,
  });
  summary.fixed = fix.fixed;
  summary.rounds = fix.rounds;
  summary.usage = fix.usage;
  summary.editedFiles = fix.editedFiles;
  summary.testFilesTouched = fix.editedFiles.filter((f) =>
    /(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\./i.test(f),
  );
  summary.needsReview = computeNeedsReview({
    unverifiable: false,
    neededFix: true,
    fixed: fix.fixed,
    testFilesTouched: summary.testFilesTouched,
  });

  await maybeCommitGroup(cwd, summary, depsSummary, fix.fixed);
  summary.durationMs = Date.now() - startedAt;
  return summary;
}

async function maybeCommitGroup(
  cwd: string,
  summary: RunSummary,
  depsSummary: string,
  shouldCommit: boolean,
): Promise<void> {
  if (!summary.branch || !shouldCommit) return;
  const note = summary.neededFix ? ` and fix ${summary.editedFiles.length} file(s)` : "";
  await commitAll(cwd, `chore(deps): bump ${depsSummary}${note}\n\nAutomated by greenbump.`);
  summary.committed = true;
  summary.diffStat = await diffStat(cwd, "HEAD~1");
  if (summary.neededFix) summary.fullDiff = await fullDiff(cwd, "HEAD~1");
}

function stripBatchOnlyFields(opts: BatchRunOptions): RunOptions {
  const { all, deps, workspace, group, failFast, ...rest } = opts;
  return rest as RunOptions;
}

/**
 * Resolve the CLI's --all / explicit-deps input into concrete UpgradeTargets.
 * Explicit lists where EVERY name is invalid are a genuine usage error and
 * throw immediately (before any git/branch work); a partially-valid list
 * defers the bad names to per-target RunFailure records instead, since one
 * typo shouldn't sink an otherwise-valid batch.
 */
export function resolveTargets(opts: BatchRunOptions, candidates: WorkspaceOutdated[]): UpgradeTarget[] {
  if (opts.all) {
    return candidates.map((c) => ({ dep: c.name, from: c.current, to: c.latest, workspacePath: c.workspacePath }));
  }

  const names = opts.deps ?? [];
  if (names.length === 0) {
    // zero-arg UX: caller should have routed to the single-dep path instead;
    // batch.ts is never invoked with neither --all nor explicit deps.
    throw new RunError("runBatch() requires --all or an explicit dependency list.");
  }

  const resolved: UpgradeTarget[] = [];
  const invalid: string[] = [];
  for (const name of names) {
    const match = resolveWorkspaceTarget(name, candidates, opts.workspace);
    if (!match) {
      invalid.push(name);
      continue;
    }
    resolved.push({
      dep: match.name,
      from: match.current,
      to: match.latest,
      workspacePath: match.workspacePath,
    });
  }

  if (resolved.length === 0) {
    throw new RunError(
      `None of the requested dependencies are outdated (or direct): ${invalid.join(", ")}. ` +
        `Available: ${candidates.map((c) => c.name).join(", ")}`,
    );
  }
  // Partial invalid names surface as synthetic failures alongside real results.
  for (const name of invalid) {
    resolved.push({ dep: name, workspacePath: undefined });
  }
  return resolved;
}
