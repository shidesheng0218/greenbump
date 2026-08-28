import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatStatsReport } from "./report.js";
import type { RunRecord } from "./recorder.js";

const now = Date.now();
const daysAgo = (n: number) => now - n * 24 * 60 * 60 * 1000;

function rec(overrides: Partial<RunRecord>): RunRecord {
  return {
    ts: now,
    dep: "react-dom",
    from: "18.3.1",
    to: "19.2.0",
    inputTokens: 0,
    outputTokens: 0,
    avoidedLlmCall: false,
    durationMs: 1000,
    fixed: true,
    needsReview: false,
    ...overrides,
  };
}

test("summarize: empty input returns a zeroed summary, not a crash", () => {
  const s = summarize([], 30);
  assert.equal(s.totalRuns, 0);
  assert.equal(s.fixRate, 0);
  assert.equal(s.estimatedSavedUsd, 0);
});

test("summarize: counts tiers and fix rate correctly", () => {
  const runs = [
    rec({ tier: 1, avoidedLlmCall: true }),
    rec({ tier: 1, avoidedLlmCall: true }),
    rec({ tier: 4, inputTokens: 20000, outputTokens: 5000, model: "claude-sonnet" }),
    rec({ fixed: false, tier: 4, inputTokens: 20000, outputTokens: 5000, model: "claude-sonnet" }),
  ];
  const s = summarize(runs, 30);
  assert.equal(s.totalRuns, 4);
  assert.equal(s.fixedRuns, 3);
  assert.equal(s.fixRate, 0.75);
  assert.equal(s.tierBreakdown[1], 2);
  assert.equal(s.tierBreakdown[4], 2);
  assert.equal(s.llmCallsAvoided, 2);
});

test("summarize: excludes runs outside the requested window", () => {
  const runs = [rec({ ts: daysAgo(1) }), rec({ ts: daysAgo(45) })];
  const s = summarize(runs, 30);
  assert.equal(s.totalRuns, 1);
});

test("summarize: estimates saved cost using this window's own tier-4 average when available", () => {
  const runs = [
    rec({ tier: 4, inputTokens: 10000, outputTokens: 2000, model: "claude-sonnet" }),
    rec({ tier: 1, avoidedLlmCall: true }),
  ];
  const s = summarize(runs, 30);
  assert.equal(s.avoidedTokensEstimate.input, 10000);
  assert.equal(s.avoidedTokensEstimate.output, 2000);
  assert.ok(s.estimatedSavedUsd > 0);
});

test("summarize: falls back to a conservative default estimate with no tier-4 history", () => {
  const runs = [rec({ tier: 1, avoidedLlmCall: true })];
  const s = summarize(runs, 30);
  assert.equal(s.avoidedTokensEstimate.input, 20000);
  assert.ok(s.estimatedSavedUsd > 0);
});

test("summarize: cache hits are counted independently of tier", () => {
  const runs = [rec({ tier: 3, avoidedLlmCall: true, cacheHit: true })];
  const s = summarize(runs, 30);
  assert.equal(s.cacheHits, 1);
});

test("formatStatsReport: empty summary renders a friendly message, no crash", () => {
  const s = summarize([], 30);
  const out = formatStatsReport(s);
  assert.match(out, /No runs recorded/);
});

test("formatStatsReport: non-empty summary mentions avoided calls and estimate label", () => {
  const runs = [
    rec({ tier: 1, avoidedLlmCall: true }),
    rec({ tier: 4, inputTokens: 20000, outputTokens: 5000, model: "claude-sonnet" }),
  ];
  const s = summarize(runs, 30);
  const out = formatStatsReport(s);
  assert.match(out, /LLM calls avoided/);
  assert.match(out, /estimate/);
});
