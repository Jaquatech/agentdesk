import type { DB } from "./db.ts";
import type { Usage } from "./providers/types.ts";

/**
 * Prices per model, in USD per million tokens. Every agent call is priced with the price of the model
 * that agent used, so a Haiku developer and a Sonnet reviewer behind the same key are billed differently.
 */
export type ModelPrice = {
  model: string;
  price_in: number;
  price_out: number;
  cache_read: number;
  cache_write: number;
  /** Prompt size (input + cache read + cache write) above which every rate is multiplied; 0 = no tier. */
  long_threshold: number;
  long_multiplier: number;
  note: string;
};

/** Starter prices (Anthropic list prices, Nov 2026). Editable on the Usage page. */
export const SEED_PRICES: ModelPrice[] = [
  { model: "claude-haiku-5-5", price_in: 0.10, price_out: 0.50, cache_read: 0.01, cache_write: 0.125, long_threshold: 100_000, long_multiplier: 5,
    note: "Anthropic list price, Nov 2026. Prompts over 100K tokens: all rates ×5." },
  { model: "claude-sonnet-5-5", price_in: 2, price_out: 10, cache_read: 0.10, cache_write: 2.5, long_threshold: 0, long_multiplier: 1,
    note: "Anthropic list price, Nov 2026. Cache write assumed 1.25× input." },
  { model: "claude-opus-5-5", price_in: 4, price_out: 20, cache_read: 0.20, cache_write: 5, long_threshold: 0, long_multiplier: 1,
    note: "Anthropic list price, Nov 2026. Cache write assumed 1.25× input." },
];

/** Exact model id first, then without a date suffix (claude-x-20251001), then the longest price id it starts with. */
export function findPrice(db: DB, model: string): ModelPrice | undefined {
  if (!model) return undefined;
  const all = db.prepare("SELECT * FROM model_prices").all() as ModelPrice[];
  const exact = all.find((p) => p.model === model);
  if (exact) return exact;
  const undated = model.replace(/-\d{8}$/, "");
  return all.find((p) => p.model === undated)
    ?? all.filter((p) => model.startsWith(p.model)).sort((a, b) => b.model.length - a.model.length)[0];
}

/** Cost of one model call. */
export function callCost(p: ModelPrice, u: Usage): number {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const m = p.long_threshold > 0 && prompt > p.long_threshold ? p.long_multiplier : 1;
  return m * (u.input * p.price_in + u.cacheRead * p.cache_read + u.cacheWrite * p.cache_write + u.output * p.price_out) / 1e6;
}
