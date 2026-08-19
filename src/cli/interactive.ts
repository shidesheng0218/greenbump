import { createInterface } from "node:readline";
import pc from "picocolors";
import type { FixSuggestion, FixDecision } from "../agent/fixer.js";

/**
 * Interactive fix confirmation — shows each AI-proposed edit and waits
 * for the user to accept / reject / edit / skip it.
 *
 * Uses node:readline (no extra deps). Designed to be wired into the fix
 * loop via `FixOptions.onFixSuggestion`.
 */

export interface InteractiveOptions {
  /** auto-accept edits when the diff is under this many changed lines */
  autoAcceptUnderLines?: number;
  /** show at most this many diff lines before truncating */
  maxDiffLines?: number;
}

export function createInteractiveHandler(opts?: InteractiveOptions) {
  const maxDiffLines = opts?.maxDiffLines ?? 80;
  const autoAcceptUnder = opts?.autoAcceptUnderLines ?? 0;

  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));

  let acceptAll = false;

  const handler = async (suggestion: FixSuggestion): Promise<FixDecision> => {
    if (acceptAll) return { action: "accept" };

    const diffLines = suggestion.diff.split("\n");
    const changedLines = diffLines.filter((l) => l.startsWith("+") || l.startsWith("-")).length;

    if (autoAcceptUnder > 0 && changedLines <= autoAcceptUnder) {
      return { action: "accept" };
    }

    process.stderr.write("\n" + pc.bold(pc.cyan("🤖 AI proposed edit")) + pc.dim(` — ${suggestion.path}`) + "\n");
    const shown = diffLines.slice(0, maxDiffLines);
    for (const line of shown) {
      if (line.startsWith("+")) process.stderr.write(pc.green(line) + "\n");
      else if (line.startsWith("-")) process.stderr.write(pc.red(line) + "\n");
      else process.stderr.write(pc.dim(line) + "\n");
    }
    if (diffLines.length > maxDiffLines) {
      process.stderr.write(pc.dim(`… (${diffLines.length - maxDiffLines} more diff lines)\n`));
    }

    for (;;) {
      const answer = (
        await ask(
          pc.bold("Apply? ") +
            `[${pc.green("y")}]es / [${pc.red("n")}]o / [${pc.yellow("e")}]dit / [${pc.blue("s")}]kip / [${pc.magenta("a")}]ll: `,
        )
      ).toLowerCase();

      switch (answer) {
        case "y":
        case "yes":
        case "":
          return { action: "accept" };
        case "n":
        case "no":
          return { action: "reject" };
        case "s":
        case "skip":
          return { action: "skip" };
        case "a":
        case "all":
          acceptAll = true;
          return { action: "accept" };
        case "e":
        case "edit": {
          process.stderr.write(pc.dim("Enter new content. End with a single '.' on its own line:\n"));
          const lines: string[] = [];
          for (;;) {
            const line = await ask("");
            if (line === ".") break;
            lines.push(line);
          }
          if (lines.length === 0) {
            process.stderr.write(pc.yellow("empty input — edit cancelled, asking again\n"));
            continue;
          }
          return { action: "edit", content: lines.join("\n") + "\n" };
        }
        default:
          process.stderr.write(pc.dim("unknown choice — y/n/e/s/a\n"));
      }
    }
  };

  return {
    handler,
    close: () => rl.close(),
  };
}

/** Print the post-run summary of an interactive session. */
export function printInteractiveSummary(stats: {
  accepted: number;
  rejected: number;
  edited: number;
  skipped: number;
}): void {
  const total = stats.accepted + stats.rejected + stats.edited + stats.skipped;
  if (total === 0) return;
  process.stderr.write(
    pc.dim(
      `\ninteractive: ${stats.accepted} accepted, ${stats.edited} edited, ${stats.rejected} rejected, ${stats.skipped} skipped\n`,
    ),
  );
}
