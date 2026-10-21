import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPrBody, renderImpactComment } from "./pr.js";
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

// ── renderImpactComment ───────────────────────────────────────────────────

test("renderImpactComment: reports known vs affected breaking changes", () => {
  const body = renderImpactComment(
    baseSummary({ impact: { knownChanges: 1934, affectedChanges: 3, filesAffected: 2, locations: 5 } }),
  )!;
  assert.match(body, /1934/);
  assert.match(body, /3\*\* of them touch this codebase/);
  assert.match(body, /2 files, 5 locations/);
});

test("renderImpactComment: says so when nothing was affected", () => {
  const body = renderImpactComment(
    baseSummary({ impact: { knownChanges: 12, affectedChanges: 0, filesAffected: 0, locations: 0 } }),
  )!;
  assert.match(body, /did not require any code changes/);
});

test("renderImpactComment: lists peer dependencies that moved", () => {
  const body = renderImpactComment(
    baseSummary({ coUpgraded: [{ name: "react", from: "18.3.1", to: "19.0.0" }] }),
  )!;
  assert.match(body, /Peer dependencies/);
  assert.match(body, /`react` 18\.3\.1 → 19\.0\.0/);
});

test("renderImpactComment: lists advisories resolved by the bump", () => {
  const body = renderImpactComment(
    baseSummary({ vulnerabilities: [{ id: "GHSA-xxxx", severity: "high", summary: "Prototype pollution" }] }),
  )!;
  assert.match(body, /Advisories on the previous version/);
  assert.match(body, /GHSA-xxxx/);
  assert.match(body, /high/);
});

test("renderImpactComment: returns null when there is nothing to report", () => {
  assert.equal(renderImpactComment(baseSummary({})), null);
});

test("renderImpactComment: an impact object with zero known changes is not reported", () => {
  assert.equal(
    renderImpactComment(baseSummary({ impact: { knownChanges: 0, affectedChanges: 0, filesAffected: 0, locations: 0 } })),
    null,
  );
});
