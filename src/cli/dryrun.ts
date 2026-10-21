import pc from "picocolors";
import { detectOutdated } from "../engine/detect.js";
import type { Outdated } from "../engine/ecosystems/types.js";
import { buildScanReport } from "../engine/scan/impact.js";
import { findPeerConflicts, type PeerConflict } from "../engine/peers.js";
import { scanOutdatedForVulns, type VulnFinding } from "../engine/security/scan.js";
import { minimalFix } from "../engine/security/osv.js";
import { WORKSPACE_ROOT, type WorkspaceOutdated } from "../engine/workspace.js";

/**
 * `--dry-run`: answer "what would happen?" without touching anything.
 *
 * Combines the deterministic impact scan, peer-requirement analysis, advisory
 * lookup and a cost estimate into one read-only report. No API key needed and
 * no model is called — the estimate is explicitly a range, not a promise.
 */

export interface DryRunOptions {
  cwd: string;
  pm: string;
  dep?: string;
  to?: string;
  security?: boolean;
  noCache?: boolean;
}

/** Rough per-fix token cost used for the estimate (mirrors the stats defaults). */
const EST_TOKENS_IN = 20_000;
const EST_TOKENS_OUT = 5_000;

export async function buildDryRunReport(opts: DryRunOptions): Promise<string> {
  const lines: string[] = [];
  const outdated = await detectOutdated(opts.pm, opts.cwd);
  if (outdated.length === 0) {
    return pc.green("✓ All dependencies are up to date — nothing to do.");
  }

  let vulnFindings: VulnFinding[] = [];
  if (opts.security) {
    vulnFindings = await scanOutdatedForVulns(opts.pm, outdated);
  }

  const target: Outdated | undefined = opts.dep
    ? outdated.find((o) => o.name === opts.dep)
    : opts.security && vulnFindings.length > 0
      ? outdated.find((o) => o.name === vulnFindings[0].name)
      : outdated[0];

  if (!target) {
    return pc.red(
      `✗ \`${opts.dep}\` is not outdated (or not a direct dependency).`,
    ) + pc.dim(`\n  Available: ${outdated.map((o) => o.name).join(", ")}`);
  }

  const to = opts.to ?? target.latest;

  lines.push(pc.bold("🌱 greenbump dry run — nothing will be changed"));
  lines.push("");
  lines.push(`${pc.cyan(target.name)} ${pc.dim(target.current)} → ${pc.green(to)}`);
  lines.push("");

  // 1. Deterministic impact
  const entry: WorkspaceOutdated = {
    name: target.name,
    current: target.current,
    wanted: target.wanted,
    latest: to,
    workspacePath: WORKSPACE_ROOT,
  };
  const report = await buildScanReport(opts.cwd, [entry], { noCache: opts.noCache });
  const det = report.detections[0];
  const knownChanges = det?.changes.length ?? 0;
  const affected = det?.changes.filter((c) => c.matches > 0) ?? [];

  lines.push(pc.bold("Impact"));
  if (knownChanges === 0) {
    lines.push(`  ${pc.dim("no known breaking changes for this path (no codemod, no cached changelog analysis)")}`);
  } else {
    lines.push(
      `  ${knownChanges} known breaking change${knownChanges === 1 ? "" : "s"}, ` +
        `${pc.green(String(affected.length))} touch this codebase`,
    );
    for (const c of affected.slice(0, 5)) {
      lines.push(`  ${pc.yellow("·")} [${c.severity}] ${c.description}`);
      for (const fg of c.fileGroups.slice(0, 2)) {
        for (const loc of fg.locations.slice(0, 2)) {
          lines.push(`      ${pc.dim(`${loc.file}:${loc.line}`)}  ${loc.excerpt}`);
        }
      }
    }
    if (affected.length === 0) {
      lines.push(`  ${pc.dim("this upgrade is unlikely to require code changes")}`);
    }
  }
  lines.push("");

  // 2. Peer requirements
  const peers: PeerConflict[] = await findPeerConflicts(opts.cwd, opts.pm, target.name, to);
  if (peers.length > 0) {
    lines.push(pc.bold("Peer dependencies"));
    for (const p of peers) {
      if (p.resolution === "upgrade") {
        lines.push(`  ${pc.yellow("·")} ${p.name} ${p.current} → ${p.suggested} ${pc.dim(`(requires ${p.required})`)}`);
      } else if (p.resolution === "missing") {
        lines.push(`  ${pc.yellow("·")} ${p.name} ${pc.dim(`required (${p.required}) but not a direct dependency`)}`);
      } else {
        lines.push(`  ${pc.yellow("·")} ${p.name} ${p.current} ${pc.dim(`does not satisfy ${p.required}`)}`);
      }
    }
    lines.push("");
  }

  // 3. Advisories
  if (opts.security) {
    const finding = vulnFindings.find((f) => f.name === target.name);
    lines.push(pc.bold("Security"));
    if (!finding) {
      lines.push(`  ${pc.green("no known advisories for")} ${target.name}@${target.current}`);
    } else {
      lines.push(`  ${pc.red(String(finding.vulns.length))} advisor${finding.vulns.length === 1 ? "y" : "ies"} — worst: ${finding.worst.severity}`);
      for (const v of finding.vulns.slice(0, 5)) {
        lines.push(`  ${pc.yellow("·")} ${v.id} ${pc.dim(`[${v.severity}]`)} ${v.summary}`);
      }
      const fix = finding.minimalFix ?? minimalFix(finding.current, finding.vulns);
      if (fix) lines.push(`  ${pc.dim("lowest fixing version:")} ${fix}`);
    }
    lines.push("");
  }

  // 4. Estimated cost — free when a codemod covers the affected changes.
  const codemodCovers =
    affected.length > 0 && affected.every((c) => c.source === "builtin-codemod");
  lines.push(pc.bold("Estimated cost"));
  if (affected.length === 0) {
    lines.push(`  ${pc.green("~$0")} ${pc.dim("— no code changes expected")}`);
  } else if (codemodCovers) {
    lines.push(`  ${pc.green("~$0")} ${pc.dim("— covered by a built-in codemod (tier 1)")}`);
  } else {
    lines.push(
      `  ${pc.yellow(`~$${((EST_TOKENS_IN / 1_000_000) * 3 + (EST_TOKENS_OUT / 1_000_000) * 15).toFixed(2)}`)} ` +
        pc.dim(`estimate: ~${EST_TOKENS_IN.toLocaleString()} in / ${EST_TOKENS_OUT.toLocaleString()} out tokens if the LLM loop is needed`),
    );
  }
  lines.push("");
  lines.push(pc.dim("Nothing was installed, edited, committed, or sent to a model."));

  return lines.join("\n");
}