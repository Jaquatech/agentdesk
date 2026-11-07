import type { ProviderKind } from "./types.ts";

/**
 * What a model can do, as far as we can tell: true / false, or null when the provider does not say.
 * Ollama reports it per model (/api/show "capabilities"); Claude models all read images and call tools.
 */
export type Capabilities = { vision: boolean | null; tools: boolean | null; thinking?: boolean | null; source: string };

const cache = new Map<string, { at: number; caps: Capabilities }>();
const TTL = 10 * 60_000;

/**
 * Ollama's native API lives at the server root, not under the OpenAI-style /v1.
 * Tolerates a pasted endpoint (https://ollama.com/api/chat, .../v1/chat/completions) and returns the root.
 */
export function ollamaRoot(baseUrl: string) {
  return (baseUrl || "http://localhost:11434/v1").trim().replace(/\/+$/, "").replace(/(?<!\/)\/(v1|api)(\/.*)?$/i, "");
}

export async function getCapabilities(kind: ProviderKind, baseUrl: string, model: string, apiKey?: string): Promise<Capabilities> {
  if (kind === "anthropic" || kind === "claude-cli") {
    return { vision: true, tools: true, source: kind === "claude-cli" ? "Claude Code reads images with its Read tool" : "Claude models" };
  }
  if (!model) return { vision: null, tools: null, source: "no model chosen" };
  if (kind === "ollama") {
    const key = `${ollamaRoot(baseUrl)}|${model}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.caps;
    try {
      const res = await fetch(`${ollamaRoot(baseUrl)}/api/show`, {
        method: "POST", body: JSON.stringify({ model }),
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, // key: Ollama Cloud
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json().catch(() => ({})) as { capabilities?: string[] };
      if (!res.ok || !Array.isArray(data.capabilities)) return { vision: null, tools: null, source: "Ollama did not report capabilities" };
      const caps = { vision: data.capabilities.includes("vision"), tools: data.capabilities.includes("tools"), thinking: data.capabilities.includes("thinking"), source: "reported by Ollama" };
      cache.set(key, { at: Date.now(), caps });
      return caps;
    } catch {
      return { vision: null, tools: null, source: "Ollama not reachable" };
    }
  }
  // Generic OpenAI-compatible servers do not describe their models.
  return { vision: null, tools: null, source: "not reported by this provider" };
}
