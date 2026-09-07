import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordLlmCall } from "./calllog.js";

test("recordLlmCall: appends one JSON line per call to the stats dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-calllog-"));
  const prev = process.env.GREENBUMP_STATS_DIR;
  process.env.GREENBUMP_STATS_DIR = dir;
  try {
    await recordLlmCall({
      ts: 1,
      feature: "fix-loop",
      provider: "stub",
      model: "stub-model",
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 42,
      attempts: 1,
      ok: true,
    });
    await recordLlmCall({
      ts: 2,
      feature: "changelog-digest",
      provider: "stub",
      model: "stub-cheap",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 7,
      attempts: 3,
      ok: false,
      error: "boom",
    });

    const lines = (await readFile(join(dir, "llm-calls.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.equal(first.feature, "fix-loop");
    assert.equal(first.ok, true);
    const second = JSON.parse(lines[1]);
    assert.equal(second.ok, false);
    assert.equal(second.error, "boom");
  } finally {
    if (prev === undefined) delete process.env.GREENBUMP_STATS_DIR;
    else process.env.GREENBUMP_STATS_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordLlmCall: a write failure is swallowed and reported via onLog, never thrown", async () => {
  const prev = process.env.GREENBUMP_STATS_DIR;
  process.env.GREENBUMP_STATS_DIR = "/dev/null/impossible";
  const logs: string[] = [];
  try {
    await recordLlmCall(
      {
        ts: 1,
        feature: "fix-loop",
        provider: "stub",
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
        attempts: 1,
        ok: true,
      },
      (m) => logs.push(m),
    );
    assert.equal(logs.length, 1);
  } finally {
    if (prev === undefined) delete process.env.GREENBUMP_STATS_DIR;
    else process.env.GREENBUMP_STATS_DIR = prev;
  }
});
