import { callCost, type ModelPrice } from "../pricing.ts";

/*
 * Cost estimate of a run, before anything is sent. Rules:
 * - Text size becomes tokens by characters: low = characters / 4, high = characters / 3
 *   (non-English text needs more tokens per character).
 * - Input tokens of one call = tokens of the system prompt + tokens of the case input.
 * - Output tokens of one call: high = maxTokens. Low = tokens of the case's `expected` text when it has one
 *   (at least 16, at most maxTokens), otherwise maxTokens / 4 (at least 16, at most maxTokens).
 * - Cost of one call = callCost(price, { input, output, cacheRead: 0, cacheWrite: 0 }), summed over all cases.
 * - A free model costs 0. A model without a price that is not free is `missing` and adds nothing to the totals.
 * - needs_cap: some model is priced and there is no cost cap. over_cap: a cap is set and high is above it.
 * Money is rounded to 6 decimals.
 */

export const MIN_OUT_TOKENS = 16;

export function estimateTokens(text: string, divisor: number): number {
  return Math.ceil(text.length / divisor);
}

export type EstimateModel = { provider_name: string; model: string; price: ModelPrice | null; free: boolean };
export type EstimateInput = {
  cases: { input: string; expected: string | null }[];
  systemPrompt: string;
  maxTokens: number;
  capUsd: number | null;
  models: EstimateModel[];
};
export type Range = { low: number; high: number };
export type ModelEstimate = {
  provider_name: string;
  model: string;
  status: "priced" | "free" | "missing";
  calls: number;
  in_tokens: Range;
  out_tokens: Range;
  low: number;
  high: number;
};
export type RunEstimate = {
  models: ModelEstimate[];
  low: number;
  high: number;
  missing: string[];
  needs_cap: boolean;
  over_cap: boolean;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function estimateRun(input: EstimateInput): RunEstimate {
  const { cases, systemPrompt, maxTokens, capUsd } = input;
  const models: ModelEstimate[] = [];
  const missing: string[] = [];
  let low = 0, high = 0;

  for (const m of input.models) {
    const status = m.free ? "free" : m.price ? "priced" : "missing";
    const est: ModelEstimate = {
      provider_name: m.provider_name, model: m.model, status, calls: cases.length,
      in_tokens: { low: 0, high: 0 }, out_tokens: { low: 0, high: 0 }, low: 0, high: 0,
    };
    for (const c of cases) {
      const inLow = estimateTokens(systemPrompt, 4) + estimateTokens(c.input, 4);
      const inHigh = estimateTokens(systemPrompt, 3) + estimateTokens(c.input, 3);
      const outHigh = maxTokens;
      const outLow = c.expected
        ? Math.min(maxTokens, Math.max(MIN_OUT_TOKENS, estimateTokens(c.expected, 4)))
        : Math.min(maxTokens, Math.max(MIN_OUT_TOKENS, Math.ceil(maxTokens / 4)));
      est.in_tokens.low += inLow; est.in_tokens.high += inHigh;
      est.out_tokens.low += outLow; est.out_tokens.high += outHigh;
      if (status === "priced" && m.price) {
        est.low += callCost(m.price, { input: inLow, output: outLow, cacheRead: 0, cacheWrite: 0 });
        est.high += callCost(m.price, { input: inHigh, output: outHigh, cacheRead: 0, cacheWrite: 0 });
      }
    }
    est.low = round6(est.low);
    est.high = round6(est.high);
    if (status === "missing") missing.push(m.model);
    else { low += est.low; high += est.high; }
    models.push(est);
  }

  low = round6(low);
  high = round6(high);
  return {
    models, low, high, missing,
    needs_cap: capUsd === null && models.some((m) => m.status === "priced"),
    over_cap: capUsd !== null && high > capUsd,
  };
}
