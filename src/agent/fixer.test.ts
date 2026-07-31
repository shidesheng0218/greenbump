import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixLoop } from "./fixer.js";
import type { Msg, Provider, ToolCall, ToolSpec, TurnResult } from "./provider.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-fixer-"));
  try {
    await fn(dir);
  } finally {
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
