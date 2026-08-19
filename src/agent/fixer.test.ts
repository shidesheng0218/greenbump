import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixLoop } from "./fixer.js";
import type { Msg, Provider, ToolCall, ToolSpec, TurnResult } from "./provider.js";
import { resetCacheForTests } from "../engine/cache/manager.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-fixer-"));
  // Isolate the on-disk cache per test: otherwise a fix learned in one test
  // (or left over from a real run in ~/.greenbump) would be replayed in
  // another and silently skip the LLM loop these tests exercise.
  const cacheDir = await mkdtemp(join(tmpdir(), "greenbump-cache-"));
  const prevCacheDir = process.env.GREENBUMP_CACHE_DIR;
  process.env.GREENBUMP_CACHE_DIR = cacheDir;
  resetCacheForTests();
  try {
    await fn(dir);
  } finally {
    if (prevCacheDir === undefined) delete process.env.GREENBUMP_CACHE_DIR;
    else process.env.GREENBUMP_CACHE_DIR = prevCacheDir;
    resetCacheForTests();
    await rm(cacheDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
}

/** A scripted provider: returns each entry in `turns` in order, one per send() call. */
function scriptedProvider(turns: Array<{ text?: string; toolCalls?: ToolCall[] }>): Provider & { calls: Msg[][] } {
  let i = 0;
  const calls: Msg[][] = [];
  return {
    name: "stub",
    model: "stub-model",
    calls,
    async send(_system: string, messages: Msg[], _tools: ToolSpec[]): Promise<TurnResult> {
      calls.push(messages);
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      return {
        text: turn.text ?? "",
        toolCalls: turn.toolCalls ?? [],
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

async function writePkg(dir: string, scripts: Record<string, string>): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "tmp", scripts }), "utf8");
}

const baseOpts = {
  pm: "npm",
  dep: "lodash",
  from: "4.17.20",
  to: "4.17.21",
  failureOutput: "TypeError: _.pad is not a function",
  maxRounds: 5,
};

test("runFixLoop: write_file then run_check passing ends the loop as fixed, tracking the edited file", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" });
    await writeFile(join(dir, "app.js"), "old content", "utf8");

    const provider = scriptedProvider([
      {
        toolCalls: [
          { id: "1", name: "write_file", input: { path: "app.js", content: "new content" } },
          { id: "2", name: "run_check", input: {} },
        ],
      },
    ]);

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider });

    assert.equal(result.fixed, true);
    assert.equal(result.rounds, 1);
    assert.deepEqual(result.editedFiles, ["app.js"]);
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);

    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(join(dir, "app.js"), "utf8"), "new content");
  });
});

test("runFixLoop: run_check failure keeps the loop going to the next round", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(1)\"" });

    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "run_check", input: {} }] },
      { toolCalls: [{ id: "2", name: "run_check", input: {} }] },
    ]);

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 2 });

    assert.equal(result.fixed, false);
    assert.equal(result.rounds, 2);
    assert.equal(provider.calls.length, 2);
  });
});

test("runFixLoop: exhausting maxRounds without a passing check reports not fixed", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(1)\"" });

    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 3 });

    assert.equal(result.fixed, false);
    assert.equal(result.rounds, 3);
  });
});

test("runFixLoop: model stopping without a tool call triggers one final verification check", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });

    const provider = scriptedProvider([{ text: "I believe this is fixed now.", toolCalls: [] }]);

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 5 });

    assert.equal(result.fixed, true);
    assert.equal(result.rounds, 1);
  });
});

test("runFixLoop: read_file/write_file reject paths that escape the project root", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, {});

    const provider = scriptedProvider([
      {
        toolCalls: [
          { id: "1", name: "write_file", input: { path: "../../etc/evil", content: "pwned" } },
        ],
      },
      { toolCalls: [{ id: "2", name: "run_check", input: {} }] },
    ]);

    await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 2 });

    // The tool call result fed back to the model should carry the error,
    // not a silently-succeeded write outside the project.
    const secondCallMessages = provider.calls[1];
    const toolMsg = secondCallMessages.find((m) => m.role === "tool") as
      | { role: "tool"; results: { content: string; isError?: boolean }[] }
      | undefined;
    assert.ok(toolMsg);
    assert.equal(toolMsg!.results[0].isError, true);
    assert.match(toolMsg!.results[0].content, /escapes project root/);

    const { pathExists } = await import("../engine/ecosystems/types.js");
    assert.equal(await pathExists(join(dir, "..", "..", "etc", "evil")), false);
  });
});

test("runFixLoop: opts.deps builds a multi-dependency prompt listing every upgrade and changelog", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });

    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);

    const result = await runFixLoop({
      ...baseOpts,
      cwd: dir,
      provider,
      maxRounds: 3,
      deps: [
        { dep: "lodash", from: "4.17.20", to: "4.17.21", changelog: "lodash notes" },
        { dep: "axios", from: "1.2.0", to: "1.3.0", changelog: "axios notes" },
      ],
    });

    assert.equal(result.fixed, true);

    const firstCallMessages = provider.calls[0];
    const userMsg = firstCallMessages.find((m) => m.role === "user") as { role: "user"; text: string } | undefined;
    assert.ok(userMsg);
    assert.match(userMsg!.text, /lodash/);
    assert.match(userMsg!.text, /axios/);
    assert.match(userMsg!.text, /lodash notes/);
    assert.match(userMsg!.text, /axios notes/);
  });
});

test("runFixLoop: single-dep call sites (no opts.deps) keep producing the original singular prompt", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });

    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);

    await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 3 });

    const firstCallMessages = provider.calls[0];
    const userMsg = firstCallMessages.find((m) => m.role === "user") as { role: "user"; text: string } | undefined;
    assert.ok(userMsg);
    assert.match(userMsg!.text, /`lodash` from 4\.17\.20 to 4\.17\.21/);
  });
});

test("runFixLoop: hitting maxTokens stops the loop early and reports budgetExceeded", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(1)\"" });

    // Each round costs 10+5=15 tokens (see scriptedProvider); cap at 20 so round 2 trips it.
    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "run_check", input: {} }] },
      { toolCalls: [{ id: "2", name: "run_check", input: {} }] },
      { toolCalls: [{ id: "3", name: "run_check", input: {} }] },
    ]);

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 5, maxTokens: 20 });

    assert.equal(result.fixed, false);
    assert.equal(result.budgetExceeded, true);
    assert.equal(result.rounds, 2);
    assert.equal(provider.calls.length, 2);
  });
});

test("runFixLoop: without maxTokens set, the loop runs to completion as before", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });

    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 3 });

    assert.equal(result.fixed, true);
    assert.equal(result.budgetExceeded, false);
  });
});

test("runFixLoop: list_dir and search_code let the agent inspect real project files", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "util.js"), "export function pad(s) { return _.pad(s); }\n", "utf8");

    const captured: string[] = [];
    const provider: Provider = {
      name: "stub",
      model: "stub-model",
      async send(_system, messages, _tools) {
        const last = messages[messages.length - 1];
        if (last.role === "tool") {
          captured.push(last.results.map((r) => r.content).join("\n"));
        }
        if (captured.length === 0) {
          return {
            text: "",
            toolCalls: [{ id: "1", name: "list_dir", input: { path: "src" } }],
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        if (captured.length === 1) {
          return {
            text: "",
            toolCalls: [{ id: "2", name: "search_code", input: { query: "_.pad", path: "src" } }],
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        return {
          text: "",
          toolCalls: [{ id: "3", name: "run_check", input: {} }],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };

    const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, maxRounds: 5 });

    assert.equal(result.fixed, true);
    assert.match(captured[0], /util\.js/);
    assert.match(captured[1], /src\/util\.js:1: .*_\.pad/);
  });
});

// ── v0.6.0: free tiers ────────────────────────────────────────────────────

test("runFixLoop: builtin codemod fixes React 18→19 without calling the LLM", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" });
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, "src", "index.tsx"),
      `import ReactDOM from 'react-dom';\nimport App from './App';\n\nReactDOM.render(<App />, document.getElementById('root'));\n`,
      "utf8",
    );

    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);

    const result = await runFixLoop({
      ...baseOpts,
      cwd: dir,
      provider,
      dep: "react-dom",
      from: "18.3.1",
      to: "19.2.0",
      failureOutput: "TypeError: ReactDOM.render is not a function\n  at src/index.tsx:4:1",
    });

    assert.equal(result.fixed, true);
    assert.equal(result.fixedByTier, 1);
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(provider.calls.length, 0); // LLM never called

    const { readFile } = await import("node:fs/promises");
    const fixed = await readFile(join(dir, "src", "index.tsx"), "utf8");
    assert.match(fixed, /createRoot/);
    assert.doesNotMatch(fixed, /ReactDOM\.render/);
  });
});

test("runFixLoop: --no-free-tiers skips codemods and goes straight to the LLM", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" });
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, "src", "index.tsx"),
      `import ReactDOM from 'react-dom';\nReactDOM.render(<App />, document.getElementById('root'));\n`,
      "utf8",
    );

    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);

    const result = await runFixLoop({
      ...baseOpts,
      cwd: dir,
      provider,
      dep: "react-dom",
      from: "18.3.1",
      to: "19.2.0",
      failureOutput: "TypeError: ReactDOM.render is not a function\n  at src/index.tsx:4:1",
      noFreeTiers: true,
    });

    assert.equal(result.fixed, true);
    assert.equal(provider.calls.length, 1); // LLM was called
    assert.equal(result.fixedByTier, 4);
  });
});

test("runFixLoop: a successful LLM fix is cached, so the second identical run is free", async () => {
  const failureOutput = "TypeError: _.padStart is not a function";
  // Share one cache dir across two project dirs
  const sharedCache = await mkdtemp(join(tmpdir(), "greenbump-shared-cache-"));
  const prevCacheDir = process.env.GREENBUMP_CACHE_DIR;
  process.env.GREENBUMP_CACHE_DIR = sharedCache;
  resetCacheForTests();

  async function runOnce(providerTurns: Array<{ text?: string; toolCalls?: ToolCall[] }>) {
    const dir = await mkdtemp(join(tmpdir(), "greenbump-fixer-"));
    await writePkg(dir, { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" });
    await writeFile(join(dir, "app.js"), "old content", "utf8");
    const provider = scriptedProvider(providerTurns);
    try {
      const result = await runFixLoop({ ...baseOpts, cwd: dir, provider, failureOutput });
      return { result, provider };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  try {
    // First run: LLM writes the fix, loop verifies → learned into cache
    const first = await runOnce([
      {
        toolCalls: [
          { id: "1", name: "write_file", input: { path: "app.js", content: "new content" } },
          { id: "2", name: "run_check", input: {} },
        ],
      },
    ]);
    assert.equal(first.result.fixed, true);
    assert.equal(first.result.fixedByTier, 4);
    assert.equal(first.provider.calls.length, 1);

    // Second run (different project, same failure): cache replay, zero LLM calls
    const second = await runOnce([{ toolCalls: [{ id: "1", name: "run_check", input: {} }] }]);
    assert.equal(second.result.fixed, true);
    assert.equal(second.result.fixedByTier, 3);
    assert.equal(second.result.cacheHit, true);
    assert.equal(second.result.usage.inputTokens, 0);
    assert.equal(second.provider.calls.length, 0);
  } finally {
    if (prevCacheDir === undefined) delete process.env.GREENBUMP_CACHE_DIR;
    else process.env.GREENBUMP_CACHE_DIR = prevCacheDir;
    resetCacheForTests();
    await rm(sharedCache, { recursive: true, force: true });
  }
});

// ── v0.6.0: interactive mode ──────────────────────────────────────────────

test("runFixLoop: interactive reject prevents the write and tells the agent", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(1)\"" });
    await writeFile(join(dir, "app.js"), "old content", "utf8");

    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "app.js", content: "new content" } }] },
      { toolCalls: [{ id: "2", name: "run_check", input: {} }] },
    ]);

    const result = await runFixLoop({
      ...baseOpts,
      cwd: dir,
      provider,
      maxRounds: 2,
      onFixSuggestion: async () => ({ action: "reject" }),
    });

    assert.equal(result.fixed, false);
    // The file must NOT have been written
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(join(dir, "app.js"), "utf8"), "old content");

    // The rejection was fed back to the model
    const secondCall = provider.calls[1];
    const toolMsg = secondCall.find((m) => m.role === "tool") as
      | { role: "tool"; results: { content: string }[] }
      | undefined;
    assert.ok(toolMsg);
    assert.match(toolMsg!.results[0].content, /REJECTED/);
  });
});

test("runFixLoop: interactive edit replaces the AI's content with the user's", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });
    await writeFile(join(dir, "app.js"), "old content", "utf8");

    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "app.js", content: "AI content" } }] },
      { toolCalls: [{ id: "2", name: "run_check", input: {} }] },
    ]);

    const result = await runFixLoop({
      ...baseOpts,
      cwd: dir,
      provider,
      maxRounds: 2,
      onFixSuggestion: async () => ({ action: "edit", content: "user-edited content" }),
    });

    assert.equal(result.fixed, true);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(join(dir, "app.js"), "utf8"), "user-edited content");
  });
});

test("runFixLoop: interactive accept applies the edit as before", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"" });
    await writeFile(join(dir, "app.js"), "old content", "utf8");

    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "app.js", content: "new content" } }] },
      { toolCalls: [{ id: "2", name: "run_check", input: {} }] },
    ]);

    const seen: string[] = [];
    const result = await runFixLoop({
      ...baseOpts,
      cwd: dir,
      provider,
      maxRounds: 2,
      onFixSuggestion: async (s) => {
        seen.push(s.path);
        assert.ok(s.diff.includes("-old content"));
        assert.ok(s.diff.includes("+new content"));
        return { action: "accept" };
      },
    });

    assert.equal(result.fixed, true);
    assert.deepEqual(seen, ["app.js"]);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(join(dir, "app.js"), "utf8"), "new content");
  });
});
