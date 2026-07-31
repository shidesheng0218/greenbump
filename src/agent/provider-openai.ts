import OpenAI from "openai";
import type { Msg, Provider, ToolSpec, TurnResult } from "./provider.js";

/** Works with any OpenAI-compatible chat-completions endpoint (DeepSeek, etc). */
export class OpenAICompatProvider implements Provider {
  readonly name: string;
  readonly model: string;
  private client: OpenAI;

  constructor(name: string, apiKey: string, baseURL: string, model: string) {
    this.name = name;
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async send(system: string, messages: Msg[], tools: ToolSpec[]): Promise<TurnResult> {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...messages.flatMap(toOpenAI),
    ];
    const resp = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 8000,
      messages: msgs,
      tools: tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const choice = resp.choices[0]?.message;
    const toolCalls = (choice?.tool_calls ?? []).map((tc) => {
      const fn = (tc as OpenAI.Chat.ChatCompletionMessageToolCall & { function: { name: string; arguments: string } }).function;
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(fn.arguments || "{}"); } catch { /* leave empty */ }
      return { id: tc.id, name: fn.name, input };
    });
    return {
      text: choice?.content ?? "",
      toolCalls,
      usage: {
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function toOpenAI(m: Msg): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (m.role === "user") return [{ role: "user", content: m.text }];
  if (m.role === "assistant")
    return [
      {
        role: "assistant",
        content: m.text || null,
        tool_calls: m.toolCalls.length
          ? m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            }))
          : undefined,
      },
    ];
  return m.results.map((r) => ({ role: "tool" as const, tool_call_id: r.id, content: r.content }));
}
