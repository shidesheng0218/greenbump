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
