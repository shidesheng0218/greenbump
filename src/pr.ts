import type { RunSummary } from "./engine/run.js";

const MAX_DIFF_CHARS = 30_000;

/** Render a Markdown PR body from a run summary. Reused by the GitHub Action. */
export function renderPrBody(s: RunSummary): string {
  const lines: string[] = [];
  lines.push(`## ⬆️ Bump \`${s.dep}\` ${s.from} → ${s.to}`);
  lines.push("");

  if (s.unverifiable) {
    lines.push(
      "> ⚠️ **Unverified** — this repo has no `build` or `test` script, so greenbump upgraded the dependency but could not confirm nothing broke. Please review.",
    );
  } else if (!s.neededFix) {
    lines.push("✅ Clean upgrade — build and tests stayed green with **no code changes**.");
  } else if (s.fixed && s.needsReview) {
    lines.push(
      `✅ The upgrade broke the build/tests. greenbump adapted the code and **build + tests are green again** — but flagged for review below.`,
    );
    lines.push("");
    lines.push(`**Files changed by the fix agent (${s.editedFiles.length}):**`);
    for (const f of s.editedFiles) lines.push(`- \`${f}\``);
  } else if (s.fixed) {
    lines.push(
      `✅ The upgrade broke the build/tests. greenbump adapted the code and **build + tests are green again**.`,
    );
    lines.push("");
    lines.push(`**Files changed by the fix agent (${s.editedFiles.length}):**`);
    for (const f of s.editedFiles) lines.push(`- \`${f}\``);
  } else {
    lines.push(
      `❌ The upgrade broke the build/tests and greenbump **could not fully fix it** within ${s.rounds} rounds. Changes are left on the branch for you to finish.`,
    );
  }

  if (s.unverifiedEdits && s.unverifiedEdits.length > 0) {
    lines.push("");
    lines.push(
      `> ⚠️ **Partial verification** — no test file references the edited file(s) below, so a green build proves they still compile, not that they behave correctly: ${s.unverifiedEdits.map((f) => `\`${f}\``).join(", ")}`,
    );
  }

  if (s.neededFix && s.testFilesTouched.length > 0) {
    lines.push("");
    lines.push(
      `> 🚨 **Review closely** — the fix agent modified test file(s), which greenbump normally avoids: ${s.testFilesTouched.map((f) => `\`${f}\``).join(", ")}`,
    );
  }

  if (s.diffStat) {
    lines.push("");
    lines.push("<details><summary>Diff stat</summary>\n");
    lines.push("```");
    lines.push(s.diffStat);
    lines.push("```");
    lines.push("</details>");
  }

  if (s.fullDiff) {
    const diff = s.fullDiff.length > MAX_DIFF_CHARS
      ? s.fullDiff.slice(0, MAX_DIFF_CHARS) + "\n… (diff truncated, see the branch for the full change)"
      : s.fullDiff;
    lines.push("");
    lines.push("<details><summary>Full diff</summary>\n");
    lines.push("```diff");
    lines.push(diff);
    lines.push("```");
    lines.push("</details>");
  }

  lines.push("");
  const meta = [`pm: ${s.packageManager}`, `duration: ${(s.durationMs / 1000).toFixed(1)}s`];
  if (s.neededFix) {
    meta.push(
      `fix loop: ${s.rounds} round(s)`,
      `${s.usage.inputTokens.toLocaleString()} in / ${s.usage.outputTokens.toLocaleString()} out tokens (your own API key)`,
    );
  }
  lines.push(`<sub>${meta.join(" · ")}</sub>`);

  lines.push("");
  lines.push("<sub>🌱 Automated by [greenbump](https://github.com/shidesheng0218/greenbump).</sub>");
  return lines.join("\n");
}

/**
 * A PR comment that tells the reviewer what this upgrade actually meant for
 * THIS repository — how many of the upgrade's known breaking changes touched
 * it, which peer dependencies had to move, and which advisories the bump
 * clears. Returns null when there is nothing worth saying, so callers can skip
 * an empty comment.
 */
export function renderImpactComment(s: RunSummary): string | null {
  const parts: string[] = [];

  if (s.impact && s.impact.knownChanges > 0) {
    const { knownChanges, affectedChanges, filesAffected, locations } = s.impact;
    parts.push(
      `### 🔍 Impact on this repository\n\n` +
        `**${knownChanges}** breaking change${knownChanges === 1 ? "" : "s"} are known for \`${s.dep}\` ${s.from} → ${s.to}; ` +
        `**${affectedChanges}** of them touch this codebase` +
        (affectedChanges > 0 ? ` (${filesAffected} file${filesAffected === 1 ? "" : "s"}, ${locations} location${locations === 1 ? "" : "s"}).` : `.`),
    );
    if (affectedChanges === 0) {
      parts.push(`_This upgrade did not require any code changes for the breaking changes we could detect._`);
    }
  }

  if (s.coUpgraded && s.coUpgraded.length > 0) {
    parts.push(
      `### 🔗 Peer dependencies moved along\n\n` +
        s.coUpgraded.map((p) => `- \`${p.name}\` ${p.from} → ${p.to}`).join("\n") +
        `\n\n_These were required by \`${s.dep}@${s.to}\`; the install would fail without them._`,
    );
  }

  if (s.vulnerabilities && s.vulnerabilities.length > 0) {
    parts.push(
      `### 🔒 Advisories on the previous version\n\n` +
        s.vulnerabilities
          .slice(0, 10)
          .map((v) => `- \`${v.id}\` **${v.severity}** — ${v.summary}`)
          .join("\n") +
        `\n\n_Resolved by upgrading to ${s.to}._`,
    );
  }

  if (parts.length === 0) return null;
  parts.push(`<sub>Analysis by greenbump — deterministic, no model was used to produce this summary.</sub>`);
  return parts.join("\n\n");
}
