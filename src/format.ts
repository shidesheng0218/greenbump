import pc from "picocolors";
import type { RunSummary, BatchItemResult } from "./engine/run.js";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m${rem}s`;
}

// A left-rule "callout" style rather than a full box: full-width unicode
// (emoji, CJK, arrows) renders at inconsistent column widths across
// terminals, which breaks right-aligned borders. A left bar needs no width
// math and never looks broken.
function bar(text: string, color: (s: string) => string = pc.dim): string {
  return `${color("│")} ${text}`;
}

/** Render a one-glance summary of a run to the given writer (e.g. console.error). */
export function printSummaryBox(summary: RunSummary, write: (s: string) => void): void {
  let headline: string;
  let barColor: (s: string) => string;
  if (summary.unverifiable) {
    barColor = pc.yellow;
    headline = `${pc.yellow("⚠")} ${summary.dep} ${summary.from} → ${summary.to} — UNVERIFIED (no build/test)`;
  } else if (!summary.neededFix) {
    barColor = pc.green;
    headline = `${pc.green("✓")} ${summary.dep} ${summary.from} → ${summary.to} — clean, nothing broke`;
  } else if (summary.fixed && summary.needsReview) {
    barColor = pc.yellow;
    headline = `${pc.yellow("⚠")} ${summary.dep} ${summary.from} → ${summary.to} — fixed, but flagged for review`;
  } else if (summary.fixed) {
    barColor = pc.green;
    headline = `${pc.green("✓")} ${summary.dep} ${summary.from} → ${summary.to} — fixed and green`;
  } else {
    barColor = pc.red;
    headline = `${pc.red("✗")} ${summary.dep} ${summary.from} → ${summary.to} — could not fully fix`;
  }

  write(bar(pc.bold(headline), barColor));
  write(bar(""));
  write(bar(`${pc.dim("package manager")}  ${summary.packageManager}`));
  write(bar(`${pc.dim("duration")}         ${formatDuration(summary.durationMs)}`));

  if (summary.neededFix) {
    write(bar(`${pc.dim("fix rounds")}       ${summary.rounds}`));
    write(
      bar(
        `${pc.dim("tokens")}           ${summary.usage.inputTokens.toLocaleString()} in / ${summary.usage.outputTokens.toLocaleString()} out`,
      ),
    );

    // Show which tier fixed it — the key cost signal for v0.6.0
    if (summary.fixedByTier && summary.fixedByTier < 4) {
      const tierNames = ["", "codemod (free)", "learned pattern (free)", "cached fix (free)"];
      write(bar(`${pc.dim("fixed by")}        ${pc.green(tierNames[summary.fixedByTier])}`));
    }

    write(bar(`${pc.dim("files edited")}     ${summary.editedFiles.length}`));
    for (const f of summary.editedFiles.slice(0, 6)) write(bar(`  ${pc.cyan("·")} ${f}`));
    if (summary.editedFiles.length > 6) write(bar(`  ${pc.dim(`… +${summary.editedFiles.length - 6} more`)}`));

    if (summary.testFilesTouched.length > 0) {
      write(bar(""));
      write(bar(pc.yellow(`⚠ agent modified test file(s) — review closely:`)));
      for (const f of summary.testFilesTouched) write(bar(`  ${pc.yellow("·")} ${f}`));
    }

    if (summary.suspiciousChanges && summary.suspiciousChanges.length > 0) {
      write(bar(""));
      write(bar(pc.yellow(`⚠ suspicious changes detected:`)));
      for (const change of summary.suspiciousChanges.slice(0, 5)) {
        write(bar(`  ${pc.yellow("·")} ${change}`));
      }
      if (summary.suspiciousChanges.length > 5) {
        write(bar(`  ${pc.dim(`… +${summary.suspiciousChanges.length - 5} more`)}`));
      }
    }

    if (summary.staticAnalysisWarnings && summary.staticAnalysisWarnings.length > 0) {
      write(bar(""));
      write(bar(pc.yellow(`⚠ static analysis warnings:`)));
      for (const warning of summary.staticAnalysisWarnings.slice(0, 3)) {
        write(bar(`  ${pc.yellow("·")} ${warning}`));
      }
      if (summary.staticAnalysisWarnings.length > 3) {
        write(bar(`  ${pc.dim(`… +${summary.staticAnalysisWarnings.length - 3} more`)}`));
      }
    }

    if (summary.apiChanges && summary.apiChanges.length > 0) {
      write(bar(""));
      write(bar(pc.yellow(`⚠ API surface changes (exports affected):`)));
      for (const change of summary.apiChanges.slice(0, 5)) {
        write(bar(`  ${pc.yellow("·")} ${change}`));
      }
      if (summary.apiChanges.length > 5) {
        write(bar(`  ${pc.dim(`… +${summary.apiChanges.length - 5} more`)}`));
      }
    }
  }

  if (summary.branch) {
    write(bar(""));
    write(
      bar(
        `${pc.dim("branch")}           ${summary.branch}${summary.committed ? pc.green(" (committed)") : pc.yellow(" (uncommitted)")}`,
      ),
    );
  }
}

/** One-line-per-target summary for --all / multi-dep / --group runs. */
export function printBatchSummary(results: BatchItemResult[], write: (s: string) => void): void {
  write(pc.bold(`${results.length} target(s):`));
  for (const item of results) {
    if ("error" in item) {
      write(bar(`${pc.red("✗")} ${item.dep} — ${item.error}`, pc.red));
      continue;
    }
    let icon: string;
    let color: (s: string) => string;
    if (item.unverifiable) {
      icon = "⚠";
      color = pc.yellow;
    } else if (!item.neededFix) {
      icon = "✓";
      color = pc.green;
    } else if (item.fixed && item.needsReview) {
      icon = "⚠";
      color = pc.yellow;
    } else if (item.fixed) {
      icon = "✓";
      color = pc.green;
    } else {
      icon = "✗";
      color = pc.red;
    }
    const suffix = item.needsReview ? " (needs review)" : !item.fixed && item.neededFix ? " (unfixed)" : "";
    write(bar(`${color(icon)} ${item.dep} ${item.from} → ${item.to}${suffix}`, color));
  }
}
