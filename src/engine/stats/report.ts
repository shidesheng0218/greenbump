import pc from "picocolors";
import { loadRuns, type RunRecord } from "./recorder.js";

/**
 * Rough $/M-token pricing for common models, used only to turn "tokens
 * avoided" into a ballpark dollar figure for `greenbump --stats`. Prices
 * change and vary by provider tier — this is explicitly an estimate, never
 * shown without that label.
 */
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "claude-opus": { inputPerM: 15, outputPerM: 75 },
  "claude-sonnet": { inputPerM: 3, outputPerM: 15 },
  "claude-haiku": { inputPerM: 0.8, outputPerM: 4 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  deepseek: { inputPerM: 0.27, outputPerM: 1.1 },
};

/** Median across the built-in pricing table — the fallback estimate when we don't know (or have never spent on) a specific model. */
function medianPricing(): { inputPerM: number; outputPerM: number } {
  const entries = Object.values(PRICING);
  const mid = (nums: number[]) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  };
  return {
    inputPerM: mid(entries.map((e) => e.inputPerM)),
    outputPerM: mid(entries.map((e) => e.outputPerM)),
  };
}

function pricingFor(model: string | undefined): { inputPerM: number; outputPerM: number } {
  if (!model) return medianPricing();
  const key = Object.keys(PRICING).find((k) => model.toLowerCase().includes(k));
  return key ? PRICING[key] : medianPricing();
}

function estimateCostUsd(inputTokens: number, outputTokens: number, model?: string): number {
  const p = pricingFor(model);
  return (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
}

export interface StatsSummary {
  windowDays: number;
  totalRuns: number;
  fixedRuns: number;
  fixRate: number;
  tierBreakdown: Record<1 | 2 | 3 | 4, number>;
  llmCallsAvoided: number;
  cacheHits: number;
  actualTokens: { input: number; output: number };
  actualCostUsd: number;
  avoidedTokensEstimate: { input: number; output: number };
  estimatedSavedUsd: number;
}

const EMPTY_SUMMARY: StatsSummary = {
  windowDays: 0,
  totalRuns: 0,
  fixedRuns: 0,
  fixRate: 0,
  tierBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0 },
  llmCallsAvoided: 0,
  cacheHits: 0,
  actualTokens: { input: 0, output: 0 },
  actualCostUsd: 0,
  avoidedTokensEstimate: { input: 0, output: 0 },
  estimatedSavedUsd: 0,
};

/** Aggregate recorded runs from the last `days` days into a stats summary. */
export function summarize(runs: RunRecord[], days = 30): StatsSummary {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const inWindow = runs.filter((r) => r.ts >= cutoff);
  if (inWindow.length === 0) return { ...EMPTY_SUMMARY, windowDays: days };

  const tierBreakdown: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let fixedRuns = 0;
  let llmCallsAvoided = 0;
  let cacheHits = 0;
  let actualInput = 0;
  let actualOutput = 0;
  let actualCostUsd = 0;
  const tier4RunsForAverage: RunRecord[] = [];

  for (const r of inWindow) {
    if (r.fixed) fixedRuns++;
    if (r.tier) tierBreakdown[r.tier]++;
    if (r.cacheHit) cacheHits++;
    if (r.avoidedLlmCall) {
      llmCallsAvoided++;
    } else if (r.tier === 4) {
      actualInput += r.inputTokens;
      actualOutput += r.outputTokens;
      actualCostUsd += estimateCostUsd(r.inputTokens, r.outputTokens, r.model);
      tier4RunsForAverage.push(r);
    }
  }

  // Estimate what the avoided runs *would* have cost, using this window's
  // own average tier-4 spend when available (most accurate), or a
  // conservative default typical-fix estimate otherwise.
  const avgInput =
    tier4RunsForAverage.length > 0
      ? actualInput / tier4RunsForAverage.length
      : 20_000;
  const avgOutput =
    tier4RunsForAverage.length > 0
      ? actualOutput / tier4RunsForAverage.length
      : 5_000;
  const avgModel = tier4RunsForAverage[0]?.model;

  const avoidedTokensEstimate = {
    input: Math.round(avgInput * llmCallsAvoided),
    output: Math.round(avgOutput * llmCallsAvoided),
  };
  const estimatedSavedUsd = estimateCostUsd(
    avoidedTokensEstimate.input,
    avoidedTokensEstimate.output,
    avgModel,
  );

  return {
    windowDays: days,
    totalRuns: inWindow.length,
    fixedRuns,
    fixRate: fixedRuns / inWindow.length,
    tierBreakdown,
    llmCallsAvoided,
    cacheHits,
    actualTokens: { input: actualInput, output: actualOutput },
    actualCostUsd,
    avoidedTokensEstimate,
    estimatedSavedUsd,
  };
}

export async function loadAndSummarize(days = 30): Promise<StatsSummary> {
  return summarize(await loadRuns(), days);
}

const TIER_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: "codemod",
  2: "learned pattern",
  3: "cached fix",
  4: "LLM",
};

/** Render the stats summary for terminal output (used by `greenbump --stats`). */
export function formatStatsReport(s: StatsSummary): string {
  const lines: string[] = [];
  if (s.totalRuns === 0) {
    lines.push(pc.dim(`No runs recorded in the last ${s.windowDays} days.`));
    return lines.join("\n");
  }

  lines.push(pc.bold(`greenbump usage — last ${s.windowDays} days`));
  lines.push("");
  lines.push(`${pc.dim("runs")}              ${s.totalRuns}`);
  lines.push(
    `${pc.dim("fixed")}            ${s.fixedRuns}/${s.totalRuns} (${(s.fixRate * 100).toFixed(0)}%)`,
  );
  lines.push("");
  lines.push(pc.bold("fix tiers:"));
  for (const tier of [1, 2, 3, 4] as const) {
    const count = s.tierBreakdown[tier];
    if (count === 0) continue;
    const label = tier < 4 ? pc.green(TIER_NAMES[tier]) : TIER_NAMES[tier];
    lines.push(`  ${label.padEnd(24)} ${count}`);
  }
  lines.push("");
  lines.push(
    `${pc.dim("LLM calls avoided")}  ${pc.green(String(s.llmCallsAvoided))} (tiers 1-3 — $0 spent)`,
  );
  if (s.cacheHits > 0) {
    lines.push(`${pc.dim("cache hits")}         ${s.cacheHits}`);
  }
  lines.push("");
  lines.push(pc.bold("tokens & cost:"));
  lines.push(
    `  ${pc.dim("actually spent")}     ${s.actualTokens.input.toLocaleString()} in / ${s.actualTokens.output.toLocaleString()} out (~$${s.actualCostUsd.toFixed(2)})`,
  );
  if (s.llmCallsAvoided > 0) {
    lines.push(
      `  ${pc.dim("avoided (estimate)")} ${s.avoidedTokensEstimate.input.toLocaleString()} in / ${s.avoidedTokensEstimate.output.toLocaleString()} out (~$${s.estimatedSavedUsd.toFixed(2)})`,
    );
    lines.push("");
    lines.push(
      pc.green(`  ~$${s.estimatedSavedUsd.toFixed(2)} saved by free fix tiers (estimate, not a bill)`),
    );
  }

  return lines.join("\n");
}
