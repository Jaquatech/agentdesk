import type { Provider } from "../../api.ts";

/** Pure helpers for the Models tab. */

export type PriceStatus = "priced" | "free" | "missing";

export type PriceFields = {
  price_status: PriceStatus;
  price_in: number | null;
  price_out: number | null;
  cache_read: number | null;
  cache_write: number | null;
};

/** Providers a model can be added for, from the raw `/api/providers` response (`{ providers, defaults }`). */
export function usableProviders(data: { providers?: Provider[] } | null | undefined): Provider[] {
  const list = data && !Array.isArray(data) ? data.providers : undefined;
  return Array.isArray(list) ? list.filter((p) => p.kind !== "claude-cli") : [];
}

const FAMILY_PREFIXES: Record<string, RegExp> = {
  anthropic: /^claude/i,
  openai: /^(gpt|o\d|chatgpt|text-|codex)/i,
};

/** Known model ids from the price table that fit a provider kind, at most 8. Unknown kinds get none. */
export function suggestModelIds(providerKind: string | undefined, prices: { model: string }[]): string[] {
  const re = providerKind ? FAMILY_PREFIXES[providerKind] : undefined;
  if (!re) return [];
  return [...new Set(prices.map((p) => p.model).filter((id) => re.test(id)))].slice(0, 8);
}

/** Yes, No or Unknown for a capability the provider may not report. */
export function capabilityLabel(v: boolean | null | undefined): "Yes" | "No" | "Unknown" {
  return v === true ? "Yes" : v === false ? "No" : "Unknown";
}

const usd = (n: number | null) => `$${(n ?? 0).toFixed(2)}`;

/** One line about the price of a model, by price status. */
export function priceLine(m: PriceFields): string {
  if (m.price_status === "free") return "Free";
  if (m.price_status === "missing") return "No price set";
  let line = `${usd(m.price_in)} in / ${usd(m.price_out)} out per Mtok`;
  const read = m.cache_read ?? 0;
  const write = m.cache_write ?? 0;
  if (read > 0 || write > 0) line += ` + cache read ${usd(read)}, cache write ${usd(write)}`;
  return line;
}
