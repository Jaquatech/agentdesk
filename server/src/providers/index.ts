import type { DB } from "../db.ts";
import type { Vault } from "../crypto.ts";
import type { AgentRow, ResolvedProvider, Engine } from "../engines/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatibleProvider } from "./openai.ts";
import type { ChatProvider, ProviderKind } from "./types.ts";
import { ApiLoopEngine } from "../engines/apiLoop.ts";
import { ClaudeCliEngine } from "../engines/claudeCli.ts";
import { DemoEngine } from "../engines/demo.ts";
import { runProgram } from "../orchestrator/shell.ts";
import { findPrice } from "../pricing.ts";
import { ollamaRoot } from "./capabilities.ts";

export type ProviderRow = {
  id: number; name: string; kind: ProviderKind; base_url: string; secret_id: number | null;
  default_model: string; price_in: number; price_out: number;
};

export const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  "claude-cli": "",
};

export function makeChatProvider(kind: ProviderKind, baseUrl: string, apiKey?: string): ChatProvider | undefined {
  // Ollama: local (no key) or Ollama Cloud (https://ollama.com + API key). A pasted /api/chat style URL is reduced to the root.
  const url = kind === "ollama" && baseUrl.trim() ? `${ollamaRoot(baseUrl)}/v1` : baseUrl || DEFAULT_BASE_URL[kind];
  if (kind === "anthropic") return new AnthropicProvider(url, apiKey ?? "");
  if (kind === "openai" || kind === "ollama") return new OpenAICompatibleProvider(url, apiKey);
  return undefined;
}

export function secretValue(db: DB, vault: Vault, secretId: number | null): string | undefined {
  if (!secretId) return undefined;
  const row = db.prepare("SELECT ciphertext FROM secrets WHERE id = ?").get(secretId) as { ciphertext: string } | undefined;
  return row ? vault.decrypt(row.ciphertext) : undefined;
}

export function resolveProvider(db: DB, vault: Vault, agent: AgentRow): ResolvedProvider {
  if (!agent.provider_id) throw new Error(`Agent ${agent.name} has no provider`);
  const p = db.prepare("SELECT * FROM providers WHERE id = ?").get(agent.provider_id) as ProviderRow | undefined;
  if (!p) throw new Error(`Provider of agent ${agent.name} no longer exists`);
  const apiKey = secretValue(db, vault, p.secret_id);
  if (p.kind === "anthropic" && !apiKey && !demoMode()) throw new Error(`Provider ${p.name} needs an API key (Settings → Providers)`);
  return {
    id: p.id, name: p.name, kind: p.kind, model: agent.model || p.default_model, apiKey, baseUrl: p.base_url,
    price: findPrice(db, agent.model || p.default_model),
    chat: makeChatProvider(p.kind, p.base_url, apiKey),
  };
}

/** Tests swap in a scripted engine here. */
export const engineOverride: { engine?: Engine } = {};
const demoEngine = new DemoEngine();
const demoMode = () => process.env.AGENTDESK_DEMO === "1";

export function engineFor(provider: ResolvedProvider): Engine {
  if (engineOverride.engine) return engineOverride.engine;
  if (demoMode()) return demoEngine;
  return provider.kind === "claude-cli" ? new ClaudeCliEngine() : new ApiLoopEngine();
}

/** Cheap connectivity check for the Providers page: list models (or `claude --version`). */
export async function testProvider(db: DB, vault: Vault, p: ProviderRow, apiKey?: string): Promise<{ ok: boolean; message: string; models?: string[] }> {
  if (demoMode()) return { ok: true, message: "Demo mode: no connection is made", models: ["demo-model"] };
  try {
    if (p.kind === "claude-cli") {
      const r = await runProgram(process.env.AGENTDESK_CLAUDE_BIN || "claude", ["--version"], { cwd: process.cwd(), timeoutMs: 20_000 });
      return r.code === 0
        ? { ok: true, message: `Claude Code ${r.stdout.trim()}`, models: ["haiku", "sonnet", "opus"] }
        : { ok: false, message: "Claude Code CLI not found on PATH" };
    }
    if (p.base_url && !/^https?:\/\/[^\s/]+/i.test(p.base_url)) return { ok: false, message: `Base URL must start with http:// or https:// (got "${p.base_url}")` };
    const chat = makeChatProvider(p.kind, p.base_url, apiKey ?? secretValue(db, vault, p.secret_id))!;
    const models = await chat.listModels();
    return { ok: true, message: `${models.length} models available`, models: models.slice(0, 200) };
  } catch (err) {
    return { ok: false, message: String((err as Error).message ?? err) };
  }
}
