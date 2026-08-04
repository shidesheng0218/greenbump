import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildReport, writeReport, REPORT_SCHEMA_VERSION } from "./report.js";
import { withTmpDir } from "./test-utils.js";
import type { RunSummary, RunFailure } from "./engine/run.js";

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
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

test("buildReport: wraps a single run in the same array envelope as a batch", () => {
  const envelope = buildReport([summary()]);
  assert.equal(envelope.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.ok(Array.isArray(envelope.runs));
  assert.equal(envelope.runs.length, 1);
  assert.ok(typeof envelope.generatedAt === "string" && !Number.isNaN(Date.parse(envelope.generatedAt)));
});

test("buildReport: batch of results, mixing successes and failures, keeps the array shape", () => {
  const failure: RunFailure = { dep: "axios", error: "install failed", fatal: true };
  const envelope = buildReport([summary({ dep: "lodash" }), failure]);
  assert.equal(envelope.runs.length, 2);
});

test("writeReport: round-trips through disk with schema and fields intact", async () => {
  await withTmpDir(async (dir) => {
    const failure: RunFailure = { dep: "axios", error: "install failed", fatal: true };
    const envelope = buildReport([summary({ dep: "lodash", rounds: 3 }), failure]);
    const path = join(dir, "report.json");

    await writeReport(path, envelope);

    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.runs.length, 2);
    assert.equal(parsed.runs[0].dep, "lodash");
    assert.equal(parsed.runs[0].rounds, 3);
    assert.equal(parsed.runs[1].dep, "axios");
    assert.equal(parsed.runs[1].error, "install failed");
    assert.equal(parsed.runs[1].fatal, true);
  });
});
