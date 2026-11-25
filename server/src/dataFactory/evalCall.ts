import type { DB } from "../db.ts";
import type { Vault } from "../crypto.ts";
import { overBudget } from "../budget.ts";
import { callCost, findPrice } from "../pricing.ts";
import { makeChatProvider, secretValue, type ProviderRow } from "../providers/index.ts";
import { textOf, type ChatProvider } from "../providers/types.ts";

/** Tests replace the chat provider here, like `engineOverride` in providers/index.ts. */
export const evalHooks: { chat?: ChatProvider } = {};

const demoMode = () => process.env.AGENTDESK_DEMO === "1";

export type EvalCallInput = {
  projectId: number; providerId: number; model: string; system: string; prompt: string;
  maxTokens: number; signal?: AbortSignal; caseKey: string;
  /** Only the demo reads it, to script its answer. */
  expected?: string | null;
};
export type EvalCallResult =
  | { ok: true; answer: string; tokensIn: number; tokensOut: number; costUsd: number | null; ms: number; usageRunId: number }
  | { ok: false; budget?: boolean; error: string; tokensIn: number; tokensOut: number; costUsd: number | null; ms: number; usageRunId: number | null };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** Scripted answer of the demo: about three out of four cases are right. The same inputs always give the same answer. */
export function demoAnswer(model: string, caseKey: string, input: string, expected: string | null): string {
  if (expected === null || expected === "") return `Demo answer to: ${input.slice(0, 60)}`;
  return hash(`${model}\n${caseKey}`) % 4 === 0 ? "I am not sure about this one." : expected;
}

const failure = (error: string, budget?: boolean): EvalCallResult =>
  ({ ok: false, budget, error, tokensIn: 0, tokensOut: 0, costUsd: null, ms: 0, usageRunId: null });

/**
 * One model call of a Data factory run. It is not an agent call (no agent, tools or worktree) but it obeys the daily limit
 * and is recorded in `runs` with kind 'eval', so Usage shows it.
 */
export async function evalCall(db: DB, vault: Vault, o: EvalCallInput): Promise<EvalCallResult> {
  const blocked = overBudget(db);
  if (blocked) return failure(blocked, true);

  const p = db.prepare("SELECT * FROM providers WHERE id = ?").get(o.providerId) as ProviderRow | undefined;
  if (!p) return failure("The provider of this model no longer exists");
  if (p.kind === "claude-cli") return failure("The Claude CLI cannot be tested as a model here. Use an API provider.");

  let chat: ChatProvider | undefined;
  if (!demoMode()) {
    chat = evalHooks.chat;
    if (!chat) {
      const apiKey = secretValue(db, vault, p.secret_id);
      if (p.kind === "anthropic" && !apiKey) return failure(`Provider ${p.name} needs an API key (Settings → Providers)`);
      chat = makeChatProvider(p.kind, p.base_url, apiKey);
    }
    if (!chat) return failure(`Provider ${p.name} cannot be called`);
  }

  const usageRunId = Number(db.prepare("INSERT INTO runs (project_id, kind, model, engine, status) VALUES (?, 'eval', ?, ?, 'running')")
    .run(o.projectId, o.model, p.kind).lastInsertRowid);
  const started = Date.now();
  const finish = (status: "ok" | "error", u: { input: number; output: number; cacheRead: number; cacheWrite: number }, cost: number | null, summary: string) => {
    const ms = Date.now() - started;
    db.prepare(`UPDATE runs SET status = ?, tokens_in = ?, tokens_out = ?, cache_read = ?, cache_write = ?, cost_usd = ?, seconds = ?, summary = ?,
      ended_at = datetime('now') WHERE id = ?`).run(status, u.input, u.output, u.cacheRead, u.cacheWrite, cost, Math.round(ms / 1000), summary, usageRunId);
    return ms;
  };
  const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  try {
    if (!chat) {
      const answer = demoAnswer(o.model, o.caseKey, o.prompt, o.expected ?? null);
      const u = { input: Math.ceil((o.system.length + o.prompt.length) / 4), output: Math.ceil(answer.length / 4), cacheRead: 0, cacheWrite: 0 };
      const ms = finish("ok", u, 0, `eval: ${o.caseKey}`);
      return { ok: true, answer, tokensIn: u.input, tokensOut: u.output, costUsd: 0, ms, usageRunId };
    }
    const res = await chat.chat({ model: o.model, system: o.system, messages: [{ role: "user", content: [{ type: "text", text: o.prompt }] }], maxTokens: o.maxTokens, signal: o.signal });
    const price = findPrice(db, o.model);
    const cost = price ? callCost(price, res.usage) : p.kind === "ollama" ? 0 : null;
    const ms = finish("ok", res.usage, cost, `eval: ${o.caseKey}`);
    return { ok: true, answer: textOf(res.content), tokensIn: res.usage.input, tokensOut: res.usage.output, costUsd: cost, ms, usageRunId };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    const ms = finish("error", none, null, message.slice(0, 2000));
    return { ok: false, error: message, tokensIn: 0, tokensOut: 0, costUsd: null, ms, usageRunId };
  }
}
