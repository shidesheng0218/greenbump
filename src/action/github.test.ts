import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInput, setOutput } from "./github.js";

test("getInput: reads INPUT_* env vars (GitHub uppercases but keeps dashes) and trims", () => {
  process.env["INPUT_ANTHROPIC-API-KEY"] = "  sk-test  ";
  try {
    assert.equal(getInput("anthropic-api-key"), "sk-test");
    assert.equal(getInput("missing-input"), "");
  } finally {
    delete process.env["INPUT_ANTHROPIC-API-KEY"];
  }
});

test("setOutput: writes heredoc format to GITHUB_OUTPUT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ghout-"));
  const file = join(dir, "output");
  process.env.GITHUB_OUTPUT = file;
  try {
    setOutput("status", "pr-opened");
    setOutput("pr-url", "https://example.com/pr/1");
    const content = await readFile(file, "utf8");
    assert.match(content, /status<<ghadelimiter_status\npr-opened\nghadelimiter_status\n/);
    assert.match(content, /pr-url<<ghadelimiter_pr-url\nhttps:\/\/example\.com\/pr\/1\nghadelimiter_pr-url\n/);
  } finally {
    delete process.env.GITHUB_OUTPUT;
    await rm(dir, { recursive: true, force: true });
  }
});

test("setOutput: without GITHUB_OUTPUT it is a no-op", () => {
  delete process.env.GITHUB_OUTPUT;
  setOutput("status", "anything"); // must not throw
});
