import type { RunSummary, RunFailure } from "./engine/run.js";

/**
 * Exit code for a single run.
 *   0 = clean success
 *   1 = hard failure (thrown error) — handled by callers directly, not here
 *   2 = fix loop ran and never got green — unchanged from pre-batch behavior
 *   3 = succeeded (or committed) but a human should look before merging
 */
export function exitCodeFor(s: RunSummary): number {
  if (s.neededFix && !s.fixed) return 2;
  if (s.needsReview) return 3;
  return 0;
}

/**
 * Severity ranking used to pick one exit code out of a batch of results.
 * Higher = worse. 1 (hard failure) outranks 2 (unfixed), which outranks
 * 3 (needs review), which outranks 0 (clean) — note this is NOT the same
 * order as the numeric exit codes themselves.
 */
function severityRank(code: number): number {
  switch (code) {
    case 1:
      return 3;
    case 2:
      return 2;
    case 3:
      return 1;
    default:
      return 0;
  }
}

/** Exit code for one batch item: a thrown/caught failure is always severity 1. */
export function exitCodeForItem(item: RunSummary | RunFailure): number {
  return "error" in item ? 1 : exitCodeFor(item);
}

/** Roll up a batch of results into the single highest-severity exit code. */
export function overallExitCode(items: Array<RunSummary | RunFailure>): number {
  let best = 0;
  let bestRank = -1;
  for (const item of items) {
    const code = exitCodeForItem(item);
    const rank = severityRank(code);
    if (rank > bestRank) {
      bestRank = rank;
      best = code;
    }
  }
  return best;
}
