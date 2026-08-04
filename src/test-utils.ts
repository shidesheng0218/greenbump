import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Msg, Provider, ToolCall, ToolSpec, TurnResult } from "./agent/provider.js";

export async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A scripted provider: returns each entry in `turns` in order, one per send() call. */
export function scriptedProvider(
  turns: Array<{ text?: string; toolCalls?: ToolCall[] }>,
): Provider & { calls: Msg[][] } {
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

export async function writePkg(dir: string, scripts: Record<string, string>, extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "tmp", scripts, ...extra }), "utf8");
}
