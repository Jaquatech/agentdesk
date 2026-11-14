import { ChatProvider, ChatRequest, ChatResponse, Block, ProviderError } from "./types.ts";

/**
 * Any OpenAI-compatible chat completions endpoint: OpenAI, Azure OpenAI (v1 path), Ollama (/v1),
 * vLLM, llama.cpp llama-server, LM Studio, OpenLLM.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  constructor(private baseUrl: string, private apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers() {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const off = req.thinking === "off";
    // Qwen3 (not the coder models, which do not think) switches thinking off with "/no_think" in the prompt.
    const softSwitch = off && /qwen3/i.test(req.model) && !/coder/i.test(req.model);
    const messages: any[] = [{ role: "system", content: softSwitch ? `${req.system}\n\n/no_think` : req.system }];
    for (const m of req.messages) {
      if (m.role === "assistant") {
        const text = m.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
        const calls = m.content.filter((b) => b.type === "tool_use").map((b: any) => ({
          id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
        // Always a string: Ollama rejects a null content ("invalid message content type: <nil>").
        messages.push({ role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}) });
      } else {
        for (const b of m.content) {
          if (b.type === "tool_result") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
        }
        const text = m.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
        const images = m.content.filter((b) => b.type === "image");
        if (images.length) {
          // Vision models (OpenAI, Ollama llava/gemma3/qwen-vl…) take images as data URLs.
          messages.push({ role: "user", content: [
            ...(text ? [{ type: "text", text }] : []),
            ...images.map((b: any) => ({ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } })),
          ] });
        } else if (text) messages.push({ role: "user", content: text });
      }
    }
    const body: Record<string, unknown> = { model: req.model, messages, max_tokens: req.maxTokens ?? 8192 };
    if (off) {
      body.think = false; // Ollama's switch; other servers ignore unknown fields
      if (/gpt-oss/i.test(req.model)) body.reasoning_effort = "low"; // gpt-oss always reasons; "low" is the least
    }
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
      if (req.toolChoice) body.tool_choice = { type: "function", function: { name: req.toolChoice } };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: req.signal,
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      const e = data?.error;
      const msg = typeof e === "string" ? e : e?.message;
      throw new ProviderError(`${res.status} ${e?.type ?? ""}: ${msg ?? res.statusText}`.trim(), res.status);
    }
    const choice = data.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const content: Block[] = [];
    const visible = msg.content ? stripThinking(String(msg.content)) : "";
    if (visible) content.push({ type: "text", text: visible });
    // Reasoning models: Ollama/vLLM return the hidden reasoning separately or inside <think>; kept for the run log.
    const raw = String(msg.content ?? "");
    const thinking = String(msg.reasoning ?? msg.reasoning_content ?? (raw.includes("</think>") ? raw.slice(0, raw.lastIndexOf("</think>")).replace(/^<think>/, "") : "")).trim();
    for (const c of msg.tool_calls ?? []) {
      let input: Record<string, unknown>;
      try { input = JSON.parse(c.function?.arguments || "{}"); } catch { input = { _raw: c.function?.arguments }; }
      content.push({ type: "tool_use", id: c.id || `call_${content.length}`, name: c.function?.name, input });
    }
    const u = data.usage ?? {};
    return {
      content, thinking: thinking || undefined,
      stopReason: content.some((b) => b.type === "tool_use") ? "tool_use"
        : choice.finish_reason === "length" ? "max_tokens" : "end",
      usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0 },
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) throw new ProviderError(`${res.status}: ${data?.error?.message ?? res.statusText}`, res.status);
    return (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name);
  }
}

/** Local reasoning models (Qwen3 etc.) may print <think>…</think> before the answer. */
function stripThinking(text: string): string {
  const i = text.lastIndexOf("</think>");
  return i >= 0 ? text.slice(i + 8).trim() : text;
}
