import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Local, append-only usage log — one JSON line per completed run. Powers
 * `greenbump --stats` ("how much has this tool saved me"). Never leaves the
 * machine: no network calls, no telemetry, just a JSONL file the user can
 * delete at any time.
 */

export interface RunRecord {
  /** epoch ms when the run finished */
  ts: number;
  dep: string;
  from: string;
  to: string;
  /** which tier produced the fix (1=codemod, 2=learned pattern, 3=cached, 4=llm); absent if unfixed/clean */
  tier?: 1 | 2 | 3 | 4;
  cacheHit?: boolean;
  inputTokens: number;
  outputTokens: number;
  /** true when tiers 1-3 avoided an LLM call entirely */
  avoidedLlmCall: boolean;
  durationMs: number;
  fixed: boolean;
  needsReview: boolean;
  /** model id used for the LLM call, if any — needed to price tokens later */
  model?: string;
}

function statsDir(): string {
  return process.env.GREENBUMP_STATS_DIR ?? join(homedir(), ".greenbump");
}

function runsPath(): string {
  return join(statsDir(), "runs.jsonl");
}

/**
 * Append one run record. Best-effort: a write failure (disk full,
 * permissions) is logged once and swallowed — stats must never fail a run.
 */
export async function recordRun(rec: RunRecord, onLog?: (m: string) => void): Promise<void> {
  try {
    await mkdir(statsDir(), { recursive: true });
    await appendFile(runsPath(), JSON.stringify(rec) + "\n", "utf8");
  } catch (err) {
    onLog?.(`stats: failed to record run (${(err as Error).message})`);
  }
}

/** Read all recorded runs, skipping any corrupt/partial lines. */
export async function loadRuns(): Promise<RunRecord[]> {
  let raw: string;
  try {
    raw = await readFile(runsPath(), "utf8");
  } catch {
    return [];
  }
  const runs: RunRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      runs.push(JSON.parse(trimmed) as RunRecord);
    } catch {
      // corrupt line (e.g. truncated by a crash mid-write) — skip it
    }
  }
  return runs;
}

/** Test helper: nothing to reset (statsDir() re-reads the env every call), kept for symmetry with the cache module. */
export function resetStatsForTests(): void {}
