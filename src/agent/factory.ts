import type { Provider } from "./provider.js";
import { AnthropicProvider } from "./provider-anthropic.js";
import { OpenAICompatProvider } from "./provider-openai.js";

type Protocol = "openai" | "anthropic";

interface Preset {
  label: string;
  protocol: Protocol;
  /** base URL for openai-compatible providers (anthropic uses SDK default) */
  baseURL?: string;
  /** env var holding the API key */
  keyEnv: string;
  /** default model, only where we can confirm a valid id */
  defaultModel?: string;
  /** providers (e.g. local Ollama) that don't need a real key */
  keyOptional?: boolean;
}

// Mainstream providers. Most speak the OpenAI protocol; only Claude is native
// Anthropic. Add a row here to support a new provider.
export const PRESETS: Record<string, Preset> = {
  openai: { label: "OpenAI", protocol: "openai", baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  anthropic: { label: "Anthropic (Claude)", protocol: "anthropic", keyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5" },
  deepseek: { label: "DeepSeek", protocol: "openai", baseURL: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY", defaultModel: "deepseek-v4-pro" },
  gemini: { label: "Google Gemini", protocol: "openai", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  groq: { label: "Groq", protocol: "openai", baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  mistral: { label: "Mistral", protocol: "openai", baseURL: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY" },
  xai: { label: "xAI Grok", protocol: "openai", baseURL: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY" },
  openrouter: { label: "OpenRouter", protocol: "openai", baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
  moonshot: { label: "Moonshot (Kimi)", protocol: "openai", baseURL: "https://api.moonshot.cn/v1", keyEnv: "MOONSHOT_API_KEY" },
  qwen: { label: "Qwen (DashScope)", protocol: "openai", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyEnv: "DASHSCOPE_API_KEY" },
  ollama: { label: "Ollama (local)", protocol: "openai", baseURL: "http://localhost:11434/v1", keyEnv: "OLLAMA_API_KEY", keyOptional: true },
};

// Order for auto-detection when no --provider is given.
const DETECT_ORDER = ["anthropic", "deepseek", "openai", "gemini", "groq", "mistral", "xai", "openrouter", "moonshot", "qwen"];

export interface ProviderChoice {
  provider?: string; // preset name
  model?: string;
  baseURL?: string; // override / generic openai-compatible endpoint
  apiKey?: string; // explicit key override
}

export function listProviders(): string {
  return Object.entries(PRESETS)
    .map(([k, p]) => `  ${k.padEnd(11)} ${p.label}${p.defaultModel ? ` (default: ${p.defaultModel})` : ""}`)
    .join("\n");
}

/** Which preset to use: explicit --provider, else first one with a key in env. */
function pickPresetName(choice: ProviderChoice): string | undefined {
  if (choice.provider) {
    if (!PRESETS[choice.provider]) {
      throw new Error(`Unknown provider "${choice.provider}". Known:\n${listProviders()}`);
    }
    return choice.provider;
  }
  return DETECT_ORDER.find((name) => process.env[PRESETS[name].keyEnv]);
}

export function createProvider(choice: ProviderChoice = {}): Provider {
  // Generic escape hatch: a raw --base-url with no preset => OpenAI-compatible.
  const presetName = pickPresetName(choice);

  if (!presetName && choice.baseURL) {
    const key = choice.apiKey || process.env.OPENAI_API_KEY || "none";
    if (!choice.model) throw new Error("--base-url requires --model (no default known for a custom endpoint).");
    return new OpenAICompatProvider("custom", key, choice.baseURL, choice.model);
  }

  if (!presetName) {
    throw new Error(
      `No API key found and no --provider given. Set one of these env vars, or pass --provider:\n${listProviders()}`,
    );
  }

  const preset = PRESETS[presetName];
  const apiKey = choice.apiKey || process.env[preset.keyEnv] || (preset.keyOptional ? "none" : "");
  if (!apiKey) {
    throw new Error(`${preset.label} selected but ${preset.keyEnv} is not set.`);
  }

  const model = choice.model || preset.defaultModel;
  if (!model) {
    throw new Error(
      `${preset.label} needs an explicit model — pass --model <id> (model ids change often, so no default is baked in).`,
    );
  }

  const baseURL = choice.baseURL || preset.baseURL;
  if (preset.protocol === "anthropic") {
    return new AnthropicProvider(apiKey, model, baseURL);
  }
  return new OpenAICompatProvider(presetName, apiKey, baseURL!, model);
}

/** True if any provider is usable (a key in env, or an explicit provider/base-url). */
export function hasAnyKey(choice: ProviderChoice = {}): boolean {
  try {
    createProvider(choice);
    return true;
  } catch {
    return false;
  }
}
