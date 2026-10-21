import { queryVulnerabilities, sortBySeverity, compareSeverity, minimalFix, type Vulnerability } from "./osv.js";
import type { Outdated } from "../ecosystems/types.js";

/**
 * Security-driven target selection: which outdated dependencies carry known
 * advisories, worst first.
 *
 * Queries are capped and run with a small concurrency limit so a project with
 * 200 outdated deps does not hammer osv.dev (and does not stall the run).
 */

export interface VulnFinding {
  name: string;
  current: string;
  latest: string;
  /** the most severe advisory for this dependency */
  worst: Vulnerability;
  vulns: Vulnerability[];
  /** lowest version that fixes the worst advisory, if known */
  minimalFix: string | null;
}

export interface ScanVulnsOptions {
  /** maximum dependencies to query (default 40) */
  limit?: number;
  /** parallel requests in flight (default 5) */
  concurrency?: number;
  onProgress?: (done: number, total: number, name: string) => void;
}

export async function scanOutdatedForVulns(
  pm: string,
  outdated: Outdated[],
  opts: ScanVulnsOptions = {},
): Promise<VulnFinding[]> {
  const limit = opts.limit ?? 40;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const todo = outdated.slice(0, limit);

  const findings: VulnFinding[] = [];
  let done = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= todo.length) return;
      const dep = todo[i];
      const vulns = await queryVulnerabilities(pm, dep.name, dep.current);
      done++;
      opts.onProgress?.(done, todo.length, dep.name);
      if (vulns.length > 0) {
        const sorted = sortBySeverity(vulns);
        findings.push({
          name: dep.name,
          current: dep.current,
          latest: dep.latest,
          worst: sorted[0],
          vulns: sorted,
          minimalFix: minimalFix(dep.current, sorted),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  // Worst-first, then most advisories, then name for a stable order.
  return findings.sort((a, b) => {
    const bySeverity = compareSeverity(a.worst.severity, b.worst.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.vulns.length !== b.vulns.length) return b.vulns.length - a.vulns.length;
    return a.name.localeCompare(b.name);
  });
}