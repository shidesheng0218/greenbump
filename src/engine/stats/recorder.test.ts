import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordRun, loadRuns, type RunRecord } from "./recorder.js";

async function withStatsDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-stats-test-"));
  const prev = process.env.GREENBUMP_STATS_DIR;
  process.env.GREENBUMP_STATS_DIR = dir;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.GREENBUMP_STATS_DIR;
    else process.env.GREENBUMP_STATS_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

const sampleRecord: RunRecord = {
  ts: Date.now(),
  dep: "react-dom",
  from: "18.3.1",
  to: "19.2.0",
  tier: 1,
  inputTokens: 0,
  outputTokens: 0,
  avoidedLlmCall: true,
  durationMs: 5000,
  fixed: true,
  needsReview: false,
};

test("recordRun + loadRuns: round-trips a record", async () => {
  await withStatsDir(async () => {
    assert.deepEqual(await loadRuns(), []);
    await recordRun(sampleRecord);
    const runs = await loadRuns();
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0], sampleRecord);
  });
});

test("recordRun: appends rather than overwrites", async () => {
  await withStatsDir(async () => {
    await recordRun(sampleRecord);
    await recordRun({ ...sampleRecord, dep: "vue" });
    const runs = await loadRuns();
    assert.equal(runs.length, 2);
    assert.equal(runs[0].dep, "react-dom");
    assert.equal(runs[1].dep, "vue");
  });
});

test("loadRuns: skips corrupt lines instead of throwing", async () => {
  await withStatsDir(async () => {
    await recordRun(sampleRecord);
    const { appendFile } = await import("node:fs/promises");
    const dir = process.env.GREENBUMP_STATS_DIR!;
    await appendFile(join(dir, "runs.jsonl"), "{not valid json\n", "utf8");
    await recordRun({ ...sampleRecord, dep: "axios" });

    const runs = await loadRuns();
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.dep), ["react-dom", "axios"]);
  });
});

test("loadRuns: missing file returns empty array, not an error", async () => {
  await withStatsDir(async () => {
    assert.deepEqual(await loadRuns(), []);
  });
});
