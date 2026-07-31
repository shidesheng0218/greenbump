// A provider-neutral chat turn, so the fix loop doesn't care whether it's
// talking to Anthropic's Messages API or an OpenAI-compatible one (DeepSeek etc).

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  send(system: string, messages: Msg[], tools: ToolSpec[]): Promise<TurnResult>;
}
