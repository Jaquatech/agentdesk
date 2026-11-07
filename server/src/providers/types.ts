/** Provider-neutral chat format (close to Anthropic's), translated per provider. */

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ImageBlock = { type: "image"; mediaType: string; data: string };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export type ChatMessage = { role: "user" | "assistant"; content: Block[] };

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** Force the model to call this tool (structured output). */
  toolChoice?: string;
  maxTokens?: number;
  /** "off": answer without a long reasoning phase, where the model can (Qwen3, gpt-oss, Ollama's think flag). */
  thinking?: "off";
  signal?: AbortSignal;
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ChatResponse = {
  content: Block[];
  /** Hidden reasoning, when the model shows it (for the run log only). */
  thinking?: string;
  stopReason: "end" | "tool_use" | "max_tokens" | "other";
  usage: Usage;
};

export interface ChatProvider {
  chat(req: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<string[]>;
}

export type ProviderKind = "anthropic" | "openai" | "ollama" | "claude-cli";

export type ProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
};

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function textOf(blocks: Block[]): string {
  return blocks.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}
