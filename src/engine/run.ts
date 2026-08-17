import { detectOutdated } from "./detect.js";
import { runChecks, type CheckOverrides } from "./checks.js";
import { upgradeDependency } from "./upgrade.js";
import { detectPackageManager, type PackageManager } from "./pm.js";
import { fetchChangelog } from "./changelog.js";
import {
  isGitRepo,
  isTreeClean,
  currentBranch,
  createBranch,
  commitAll,
  diffStat,
  fullDiff,
} from "./git.js";
import { runFixLoop } from "../agent/fixer.js";
import { createProvider } from "../agent/factory.js";
import { runStaticAnalysis } from "./verify.js";
import { detectSuspiciousChanges } from "./change-detector.js";

export interface RunOptions {
  cwd: string;
  /** explicit ecosystem id (npm, poetry, cargo, …); auto-detected if omitted */
  ecosystem?: string;
  /** full override command for the build step, e.g. "make build" */
  buildCmd?: string;
  /** full override command for the test step, e.g. "make test" */
  testCmd?: string;
  /** specific dependency to upgrade; if omitted, the most-outdated one is chosen */
  dep?: string;
  /** target version; defaults to `latest` from `npm outdated` */
  to?: string;
  /** explicit model override; defaults per detected provider */
  model?: string;
  /** provider preset name (openai, anthropic, deepseek, …); auto-detected if omitted */
  provider?: string;
  /** override / generic OpenAI-compatible base URL */
  baseURL?: string;
  /** explicit API key override */
  apiKey?: string;
  maxRounds: number;
  /** hard cap on total (input + output) tokens spent by the fix loop; unset = no cap */
  maxTokens?: number;
  /** skip creating a git branch and operate in place */
  noGit?: boolean;
  onLog?: (m: string) => void;
}

export interface RunSummary {
  dep: string;
  from: string;
  to: string;
  packageManager: PackageManager;
  branch?: string;
  baselineGreen: boolean;
  neededFix: boolean;
  fixed: boolean;
  unverifiable: boolean;
  /**
   * A human should look before merging: the fix agent touched a test file to
   * get green, or the upgrade couldn't be verified at all (no build/test
   * scripts). Never flips `fixed` — this is an orthogonal "review me" signal,
   * not a correctness verdict.
   */
  needsReview: boolean;
  committed: boolean;
  rounds: number;
  usage: { inputTokens: number; outputTokens: number };
  editedFiles: string[];
  testFilesTouched: string[];
  suspiciousChanges?: string[];
  staticAnalysisWarnings?: string[];
  diffStat?: string;
  fullDiff?: string;
  durationMs: number;
}

export class RunError extends Error {}

/**
 * Pure decision logic for `needsReview`, split out so it's directly
 * testable without spinning up a real npm/fix-loop run. `fixed`/`neededFix`
 * are the fix loop's own outcome; `unverifiable` and `testFilesTouched` are
 * the two independent triggers (see the `needsReview` field doc above).
 */
export function computeNeedsReview(input: {
  unverifiable: boolean;
  neededFix: boolean;
  fixed: boolean;
  testFilesTouched: string[];
  budgetExceeded?: boolean;
}): boolean {
  if (input.unverifiable) return true;
  if (input.budgetExceeded) return true;
  if (!input.neededFix) return false;
  return input.fixed && input.testFilesTouched.length > 0;
}

/** A batch target that never got far enough to produce a RunSummary. */
export interface RunFailure {
  dep: string;
  error: string;
  fatal: true;
}

export type BatchItemResult = RunSummary | RunFailure;

export async function run(opts: RunOptions): Promise<RunSummary> {
  const log = opts.onLog ?? (() => {});
  const { cwd } = opts;
  const startedAt = Date.now();

  const pm = opts.ecosystem ?? (await detectPackageManager(cwd));
  const checkOverrides: CheckOverrides = { buildCmd: opts.buildCmd, testCmd: opts.testCmd };
  log(`ecosystem: ${pm}`);

  // 1. detect
  log("detecting outdated dependencies…");
  const outdated = await detectOutdated(pm, cwd);
  if (outdated.length === 0) {
    throw new RunError("No outdated dependencies found — nothing to upgrade.");
  }

  // 2. select target
  const target = opts.dep
    ? outdated.find((o) => o.name === opts.dep)
    : outdated[0];
  if (!target) {
    throw new RunError(
      `\`${opts.dep}\` is not outdated (or not a direct dependency). Available: ${outdated
        .map((o) => o.name)
        .join(", ")}`,
    );
  }
  const from = target.current;
  const to = opts.to ?? target.latest;
  log(`target: ${target.name} ${from} → ${to}`);

  // 3. git isolation
  let branch: string | undefined;
  const gitRepo = await isGitRepo(cwd);
  if (gitRepo && !opts.noGit) {
    if (!(await isTreeClean(cwd))) {
      throw new RunError(
        "Working tree is dirty. Commit or stash your changes first (or pass --no-git).",
      );
    }
    await currentBranch(cwd); // ensure HEAD resolves
    branch = `greenbump/${target.name.replace(/[^a-zA-Z0-9._-]/g, "-")}-${to}`;
    await createBranch(cwd, branch);
    log(`created branch ${branch}`);
  }

  // 4. baseline — refuse to run if it's already broken, so we never chase
  //    failures that predate the upgrade.
  log("running baseline build + tests…");
  const baseline = await runChecks(pm, cwd, checkOverrides);
  if (!baseline.ok && !baseline.unverifiable) {
    throw new RunError(
      `Baseline is already failing (${baseline.failedStep}) before any upgrade. ` +
        `Fix that first — greenbump can't tell your pre-existing failures from upgrade breakage.`,
    );
  }
  const baselineGreen = baseline.ok && !baseline.unverifiable;

  // 5. upgrade
  log(`installing ${target.name}@${to}…`);
  const up = await upgradeDependency(pm, cwd, target.name, to);
  if (!up.ok) {
    throw new RunError(`${pm} failed to install ${target.name}@${to}:\n${up.output}`);
  }

  // 6. verify
  const post = await runChecks(pm, cwd, checkOverrides);

  const summary: RunSummary = {
    dep: target.name,
    from,
    to,
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
    // no way to verify — still a valid PR, just flagged
    log("no build/test scripts — upgrade applied but UNVERIFIED");
    summary.needsReview = true;
    await maybeCommit(cwd, summary, true);
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  if (post.ok) {
    // clean upgrade, nothing broke
    log("clean upgrade — build + tests green with no code changes");
    await maybeCommit(cwd, summary, true);
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  // 7. broke — fetch changelog context, then run the fix agent
  summary.neededFix = true;
  const changelog = await fetchChangelog(target.name, from, to);
  if (changelog) log(`found changelog/release notes for ${target.name}`);

  const provider = createProvider({
    provider: opts.provider,
    model: opts.model,
    baseURL: opts.baseURL,
    apiKey: opts.apiKey,
  });
  log(`upgrade broke ${post.failedStep} — starting fix loop via ${provider.name} (${provider.model})`);
  const fix = await runFixLoop({
    cwd,
    pm,
    checkOverrides,
    provider,
    maxRounds: opts.maxRounds,
    maxTokens: opts.maxTokens,
    dep: target.name,
    from,
    to,
    failureOutput: post.output,
    changelog,
    onLog: log,
  });
  summary.fixed = fix.fixed;
  summary.rounds = fix.rounds;
  summary.usage = fix.usage;
  summary.editedFiles = fix.editedFiles;
  summary.testFilesTouched = fix.editedFiles.filter((f) => /(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\./i.test(f));

  // Run static analysis (TypeScript + ESLint)
  log("running static analysis…");
  const staticResults = await runStaticAnalysis(cwd, { strictLint: false });
  const typesFailed = staticResults.some(r => r.stage === "types" && !r.passed);

  if (typesFailed) {
    log("⚠️  TypeScript type check failed after fix");
    summary.needsReview = true;
    summary.staticAnalysisWarnings = staticResults
      .filter(r => !r.passed)
      .flatMap(r => r.warnings || []);
  }

  // Detect suspicious changes
  const suspiciousChanges = await detectSuspiciousChanges(cwd);
  const criticalChanges = suspiciousChanges.filter(c => c.severity === "critical");

  if (criticalChanges.length > 0) {
    log("⚠️  Suspicious changes detected (test modifications, large deletions)");
    summary.needsReview = true;
    summary.suspiciousChanges = suspiciousChanges.map(c =>
      `${c.type}: ${c.file} - ${c.description}`
    );
  }

  summary.needsReview = computeNeedsReview({
    unverifiable: false,
    neededFix: true,
    fixed: fix.fixed,
    testFilesTouched: summary.testFilesTouched,
    budgetExceeded: fix.budgetExceeded,
  }) || summary.needsReview; // Preserve needsReview if already set by static analysis or suspicious changes

  await maybeCommit(cwd, summary, fix.fixed);
  summary.durationMs = Date.now() - startedAt;
  return summary;
}

async function maybeCommit(
  cwd: string,
  summary: RunSummary,
  shouldCommit: boolean,
): Promise<void> {
  if (!summary.branch || !shouldCommit) return;
  const note = summary.neededFix
    ? ` and fix ${summary.editedFiles.length} file(s)`
    : "";
  await commitAll(
    cwd,
    `chore(deps): bump ${summary.dep} ${summary.from} → ${summary.to}${note}\n\nAutomated by greenbump.`,
  );
  summary.committed = true;
  summary.diffStat = await diffStat(cwd, "HEAD~1");
  if (summary.neededFix) summary.fullDiff = await fullDiff(cwd, "HEAD~1");
}
