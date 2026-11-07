import { ChatProvider, ChatRequest, ChatResponse, Block, ProviderError } from "./types.ts";

const VERSION = "2023-06-01";

export class AnthropicProvider implements ChatProvider {
  constructor(private baseUrl: string, private apiKey: string) {
    this.baseUrl = (baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  }

  private headers() {
    return { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": VERSION };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 8192,
      // The system prompt and tool list stay the same across turns, so they are cached.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages.map((m, i) => ({
        role: m.role,
        content: m.content.map((raw, j) => {
          const b = raw.type === "image"
            ? { type: "image", source: { type: "base64", media_type: raw.mediaType, data: raw.data } }
            : raw;
          // Cache the conversation up to the latest user turn too (long tool loops re-send it every turn).
          return i === req.messages.length - 1 && j === m.content.length - 1 && m.role === "user"
            ? { ...b, cache_control: { type: "ephemeral" } }
            : b;
        }),
      })),
    };
    if (req.tools?.length) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = { type: "tool", name: req.toolChoice };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: req.signal,
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      const e = data?.error;
      throw new ProviderError(`Anthropic ${res.status} ${e?.type ?? ""}: ${e?.message ?? res.statusText}`.trim(), res.status);
    }
    const u = data.usage ?? {};
    return {
      content: (data.content ?? []).filter((b: Block) => b.type === "text" || b.type === "tool_use"),
      stopReason: data.stop_reason === "tool_use" ? "tool_use" : data.stop_reason === "max_tokens" ? "max_tokens"
        : data.stop_reason === "end_turn" ? "end" : "other",
      usage: {
        input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
      },
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/v1/models?limit=100`, { headers: this.headers() });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) throw new ProviderError(`Anthropic ${res.status}: ${data?.error?.message ?? res.statusText}`, res.status);
    return (data.data ?? []).map((m: { id: string }) => m.id);
  }
}
