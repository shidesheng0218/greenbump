import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPrBody } from "./pr.js";
import type { RunSummary } from "./engine/run.js";

function baseSummary(overrides: Partial<RunSummary>): RunSummary {
  return {
    dep: "react",
    from: "18.3.1",
    to: "19.2.0",
    packageManager: "npm",
    baselineGreen: true,
    neededFix: true,
    fixed: true,
    unverifiable: false,
    needsReview: false,
    committed: true,
    rounds: 3,
    usage: { inputTokens: 1000, outputTokens: 200 },
    editedFiles: ["src/App.tsx"],
    testFilesTouched: [],
    durationMs: 12_000,
    ...overrides,
  };
}

test("renderPrBody: fixed-with-review mentions both the fix and the review flag", () => {
  const body = renderPrBody(baseSummary({ needsReview: true }));
  assert.match(body, /green again/);
  assert.match(body, /flagged for review/);
  assert.match(body, /src\/App\.tsx/);
});

test("renderPrBody: test files touched get the 🚨 callout", () => {
  const body = renderPrBody(baseSummary({ testFilesTouched: ["app.test.ts"], needsReview: true }));
  assert.match(body, /Review closely/);
  assert.match(body, /app\.test\.ts/);
});

test("renderPrBody: unfixable upgrade says so plainly", () => {
  const body = renderPrBody(baseSummary({ fixed: false, rounds: 15 }));
  assert.match(body, /could not fully fix/);
});

test("renderPrBody: unverifiable run carries the warning", () => {
  const body = renderPrBody(baseSummary({ unverifiable: true, neededFix: false, fixed: false }));
  assert.match(body, /Unverified/);
});

test("renderPrBody: oversized diffs are truncated with a marker", () => {
  const body = renderPrBody(baseSummary({ fullDiff: "x".repeat(60_000) }));
  assert.match(body, /diff truncated/);
  assert.ok(body.length < 40_000);
});
