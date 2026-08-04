import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor, overallExitCode } from "./exitcode.js";
import type { RunSummary, RunFailure } from "./engine/run.js";

function summary(overrides: Partial<RunSummary>): RunSummary {
  return {
    dep: "lodash",
    from: "4.17.20",
    to: "4.17.21",
    packageManager: "npm",
    baselineGreen: true,
    neededFix: false,
    fixed: true,
    unverifiable: false,
    needsReview: false,
    committed: true,
    rounds: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    editedFiles: [],
    testFilesTouched: [],
    durationMs: 0,
    ...overrides,
  };
}

test("exitCodeFor: clean success is 0", () => {
  assert.equal(exitCodeFor(summary({})), 0);
});

test("exitCodeFor: unfixed after a fix attempt is 2", () => {
  assert.equal(exitCodeFor(summary({ neededFix: true, fixed: false })), 2);
});

test("exitCodeFor: needsReview (test file touched) is 3", () => {
  assert.equal(exitCodeFor(summary({ neededFix: true, fixed: true, needsReview: true })), 3);
});

test("exitCodeFor: needsReview from unverifiable is 3", () => {
  assert.equal(exitCodeFor(summary({ unverifiable: true, needsReview: true })), 3);
});

test("exitCodeFor: unfixed (2) takes priority over needsReview when both would apply", () => {
  // neededFix && !fixed always wins — needsReview never overloads that state.
  assert.equal(exitCodeFor(summary({ neededFix: true, fixed: false, needsReview: true })), 2);
});

test("overallExitCode: a hard failure (1) outranks everything else", () => {
  const failure: RunFailure = { dep: "axios", error: "boom", fatal: true };
  const items = [summary({}), summary({ neededFix: true, fixed: false }), failure];
  assert.equal(overallExitCode(items), 1);
});

test("overallExitCode: unfixed (2) outranks needsReview (3) when no hard failure", () => {
  const items = [
    summary({ neededFix: true, fixed: true, needsReview: true }),
    summary({ neededFix: true, fixed: false }),
  ];
  assert.equal(overallExitCode(items), 2);
});

test("overallExitCode: needsReview (3) outranks clean success (0)", () => {
  const items = [summary({}), summary({ unverifiable: true, needsReview: true })];
  assert.equal(overallExitCode(items), 3);
});

test("overallExitCode: all clean is 0", () => {
  assert.equal(overallExitCode([summary({}), summary({})]), 0);
});

test("overallExitCode: empty batch is 0", () => {
  assert.equal(overallExitCode([]), 0);
});
