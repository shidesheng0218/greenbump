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

  // Peer dependencies pulled along with the target — without these the install
  // itself would have failed (react-dom@19 requiring react@19, and so on).
  if (summary.coUpgraded && summary.coUpgraded.length > 0) {
    write(
      bar(
        `${pc.dim("peers upgraded")}  ${summary.coUpgraded.map((p) => `${p.name} ${p.from}→${p.to}`).join(", ")}`,
      ),
    );
  }

  if (summary.vulnerabilities && summary.vulnerabilities.length > 0) {
    write(bar(""));
    write(bar(pc.red(`🔒 ${summary.vulnerabilities.length} known advisor${summary.vulnerabilities.length === 1 ? "y" : "ies"} on the old version:`)));
    for (const v of summary.vulnerabilities.slice(0, 5)) {
      write(bar(`  ${pc.red("·")} ${v.id} [${v.severity}] ${v.summary.slice(0, 80)}`));
    }
    if (summary.vulnerabilities.length > 5) {
      write(bar(`  ${pc.dim(`… +${summary.vulnerabilities.length - 5} more`)}`));
    }
  }

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

    if (summary.enhancedRounds) {
      write(
        bar(
          `${pc.dim("enhanced loop")}   ${summary.enhancedRounds} extra round(s) — verifier findings fixed automatically`,
        ),
      );
    }

    // What this upgrade actually meant for this codebase: of all the breaking
  // changes known for the path, how many touched it. The number that makes a
  // "fixed" claim verifiable rather than hopeful.
    if (summary.impact && summary.impact.knownChanges > 0) {
      const { knownChanges, affectedChanges, filesAffected, locations } = summary.impact;
      write(
        bar(
          `${pc.dim("impact")}          ${knownChanges} known change(s) · ${pc.green(String(affectedChanges))} touch this code ` +
            pc.dim(`(${filesAffected} file(s), ${locations} location(s))`),
        ),
      );
    }

    write(bar(`${pc.dim("files edited")}     ${summary.editedFiles.length}`));
    for (const f of summary.editedFiles.slice(0, 6)) write(bar(`  ${pc.cyan("·")} ${f}`));
    if (summary.editedFiles.length > 6) write(bar(`  ${pc.dim(`… +${summary.editedFiles.length - 6} more`)}`));

    if (summary.testFilesTouched.length > 0) {
      write(bar(""));
      write(bar(pc.yellow(`⚠ agent modified test file(s) — review closely:`)));
      for (const f of summary.testFilesTouched) write(bar(`  ${pc.yellow("·")} ${f}`));
    }

    if (summary.unverifiedEdits && summary.unverifiedEdits.length > 0) {
      write(bar(""));
      write(bar(pc.yellow(`⚠ no test references these edited file(s) — green means "compiles", not "works":`)));
      for (const f of summary.unverifiedEdits.slice(0, 5)) write(bar(`  ${pc.yellow("·")} ${f}`));
      if (summary.unverifiedEdits.length > 5) {
        write(bar(`  ${pc.dim(`… +${summary.unverifiedEdits.length - 5} more`)}`));
      }
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

  // Failed fix: the working tree still holds the upgraded dependency plus
  // whatever partial edits the agent made. Tell the user exactly how to get
  // back to a clean state — a red run must never leave them stranded.
  if (summary.neededFix && !summary.fixed) {
    write(bar(""));
    if (summary.branch && summary.baseBranch && !summary.committed) {
      write(bar(pc.red("✗ nothing was committed — the branch holds the upgrade + partial AI edits.")));
      write(bar(`${pc.dim("to inspect")}       git diff`));
      write(bar(`${pc.dim("to roll back")}     git reset --hard && git checkout ${summary.baseBranch} && git branch -D ${summary.branch}`));
    } else if (!summary.branch) {
      write(
        bar(
          pc.red("✗ no git isolation — the upgrade and partial AI edits are in your working tree.") +
            pc.dim(" Review the changes (in a git repo: `git diff`, discard with `git restore .`), or re-install the previous version."),
        ),
      );
    }
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

/** Format the deterministic impact analysis report for --scan. */
export function formatScanImpact(report: import("./engine/scan/impact.js").ScanReport): string {
  const lines: string[] = [];
  const { summary, detections } = report;

  lines.push(
    pc.bold(
      `🌱 greenbump scan — ${summary.depsScanned} outdated ${summary.depsScanned === 1 ? "dependency" : "dependencies"}, ${summary.depsWithKnownBreaking} with known breaking changes`,
    ),
  );
  lines.push("");

  for (const d of detections) {
    // Dependency header line
    const wsLabel = d.workspacePath && d.workspacePath !== "." ? `  (${d.workspacePath})` : "";
    let statusLabel: string;
    if (d.status === "unknown") {
      statusLabel = pc.dim("  [unknown — no cached analysis]");
    } else if (d.status === "info-only") {
      statusLabel = pc.dim("  [info-only — config migration, no code patterns]");
    } else if (d.status === "approx") {
      statusLabel = pc.yellow(`  [breaking: ${d.changes.length} ${d.changes.length === 1 ? "change" : "changes"} — ~${d.filesMatched} files, ~${d.locationsMatched} locations]`);
    } else {
      const truncMark = d.truncated ? "≈ " : "";
      statusLabel = `  [breaking: ${d.changes.length} ${d.changes.length === 1 ? "change" : "changes"} — ${truncMark}${d.filesMatched} files, ${truncMark}${d.locationsMatched} locations]`;
    }
    lines.push(`${pc.cyan(d.name)} ${pc.dim(d.current)} → ${pc.green(d.latest)}${wsLabel}${statusLabel}`);

    // Changes
    if (d.status === "ok" || d.status === "approx") {
      d.changes.forEach((change, idx) => {
        const approxMark = change.approx ? pc.yellow("[~] ") : "";
        lines.push(`  ${idx + 1}. ${approxMark}[${change.severity}] ${change.description} (${change.source})`);
        if (change.rewrite) {
          lines.push(`     ${pc.dim("fix:")} ${change.rewrite}`);
        }
        // Show up to 5 locations per change
        const maxShown = 5;
        let shownCount = 0;
        for (const fg of change.fileGroups) {
          for (const loc of fg.locations) {
            if (shownCount >= maxShown) break;
            lines.push(`       ${pc.dim(loc.file)}:${loc.line}:  ${loc.excerpt}`);
            shownCount++;
          }
          if (shownCount >= maxShown) break;
        }
        if (change.matches > maxShown) {
          lines.push(`       ${pc.dim(`… +${change.matches - maxShown} more`)}`);
        }
        lines.push(`     ${pc.dim(`→ ${change.matches} ${change.matches === 1 ? "location" : "locations"} in ${change.fileGroups.length} ${change.fileGroups.length === 1 ? "file" : "files"}`)}`);
      });
    } else if (d.status === "unknown") {
      lines.push(`  ${pc.dim(`Run: greenbump ${d.name} && greenbump --scan   (uses your API key once, then free)`)}`);
    } else if (d.status === "info-only") {
      // Show first change description
      if (d.changes.length > 0) {
        lines.push(`  ${pc.dim(d.changes[0].description)}`);
      }
      if (d.fileCreations) {
        for (const fc of d.fileCreations) {
          lines.push(`  ${pc.dim(`note: will create ${fc.path}`)}`);
        }
      }
    }
    lines.push("");
  }

  // Summary
  if (summary.depsWithKnownBreaking > 0) {
    const truncNote = summary.truncated ? " (approximate — some hits truncated)" : "";
    lines.push(
      pc.bold(
        `Summary: ${summary.depsWithKnownBreaking} ${summary.depsWithKnownBreaking === 1 ? "dependency" : "dependencies"} with breaking changes touch ${summary.filesAffected} ${summary.filesAffected === 1 ? "file" : "files"}, ${summary.locationsAffected} ${summary.locationsAffected === 1 ? "location" : "locations"}.${truncNote}`,
      ),
    );
    lines.push(pc.dim("Deterministic preview: no LLM calls, no network — sources: built-in codemods, changelog cache."));
  } else {
    lines.push(pc.green("✓ No known breaking changes detected in outdated dependencies."));
  }

  return lines.join("\n");
}
