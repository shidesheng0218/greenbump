import { test } from "node:test";
import assert from "node:assert/strict";
import { printSummaryBox } from "./format.js";
import type { RunSummary } from "./engine/run.js";

function baseSummary(overrides: Partial<RunSummary>): RunSummary {
  return {
    dep: "react",
    from: "18.3.1",
    to: "19.2.0",
    packageManager: "npm",
    baselineGreen: true,
    neededFix: true,
    fixed: false,
    unverifiable: false,
    needsReview: false,
    committed: false,
    rounds: 3,
    usage: { inputTokens: 100, outputTokens: 50 },
    editedFiles: ["src/App.tsx"],
    testFilesTouched: [],
    durationMs: 1234,
    ...overrides,
  };
}

function render(summary: RunSummary): string {
  const lines: string[] = [];
  // strip ANSI so assertions match plain text
  printSummaryBox(summary, (s) => lines.push(s.replace(/\[\d+m/g, "")));
  return lines.join("\n");
}

test("printSummaryBox: failed fix on a branch prints exact rollback commands", () => {
  const out = render(
    baseSummary({ branch: "greenbump/react-19.2.0", baseBranch: "main", committed: false }),
  );
  assert.match(out, /git reset --hard && git checkout main && git branch -D greenbump\/react-19\.2\.0/);
  assert.match(out, /nothing was committed/);
});

test("printSummaryBox: failed fix without git isolation warns about the dirty working tree", () => {
  const out = render(baseSummary({ branch: undefined, baseBranch: undefined }));
  assert.match(out, /no git isolation/);
  assert.doesNotMatch(out, /git branch -D/);
});

test("printSummaryBox: successful fix prints no rollback block", () => {
  const out = render(
    baseSummary({ fixed: true, committed: true, branch: "greenbump/react-19.2.0", baseBranch: "main" }),
  );
  assert.doesNotMatch(out, /git reset --hard/);
  assert.doesNotMatch(out, /no git isolation/);
});
