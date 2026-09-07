import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Per-call LLM cost ledger — one JSON line per provider call, complementing
 * the per-run log in stats/recorder.ts. Records feature, model, tokens,
 * latency, and outcome so cost is attributable to a task, not just a run.
 * Local and append-only like runs.jsonl: no network, no telemetry.
 */

export interface LlmCallRecord {
  /** epoch ms when the call finished */
  ts: number;
  /** which product task made the call, e.g. "fix-loop" | "changelog-digest" */
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** how many attempts the retry wrapper needed (1 = no retry) */
  attempts: number;
  ok: boolean;
  /** error message on final failure */
  error?: string;
}

function statsDir(): string {
  return process.env.GREENBUMP_STATS_DIR ?? join(homedir(), ".greenbump");
}

function callsPath(): string {
  return join(statsDir(), "llm-calls.jsonl");
}

/**
 * Append one call record. Best-effort: a write failure is logged once and
 * swallowed — cost logging must never fail a run.
 */
export async function recordLlmCall(rec: LlmCallRecord, onLog?: (m: string) => void): Promise<void> {
  try {
    await mkdir(statsDir(), { recursive: true });
    await appendFile(callsPath(), JSON.stringify(rec) + "\n", "utf8");
  } catch (err) {
    onLog?.(`stats: failed to record LLM call (${(err as Error).message})`);
  }
}

/** Callback shape used to plumb per-call records out of the agent/engine layers. */
export type LlmCallSink = (rec: Omit<LlmCallRecord, "ts">) => void | Promise<void>;
