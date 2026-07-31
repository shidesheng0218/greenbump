import Anthropic from "@anthropic-ai/sdk";
import type { Msg, Provider, ToolSpec, TurnResult } from "./provider.js";

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.model = model;
    const url = baseURL || process.env.ANTHROPIC_BASE_URL;
    this.client = new Anthropic({ apiKey, ...(url ? { baseURL: url } : {}) });
  }

  async send(system: string, messages: Msg[], tools: ToolSpec[]): Promise<TurnResult> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      })),
      messages: messages.map(toAnthropic),
    });

    let text = "";
    const toolCalls = [];
    for (const block of resp.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use")
        toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
    }
    return {
      text,
      toolCalls,
      usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
    };
  }
}

function toAnthropic(m: Msg): Anthropic.MessageParam {
  if (m.role === "user") return { role: "user", content: m.text };
  if (m.role === "assistant") {
    const content: Anthropic.ContentBlockParam[] = [];
    if (m.text) content.push({ type: "text", text: m.text });
    for (const tc of m.toolCalls)
      content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    return { role: "assistant", content };
  }
  return {
    role: "user",
    content: m.results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.id,
      content: r.content,
      is_error: r.isError || undefined,
    })),
  };
}
