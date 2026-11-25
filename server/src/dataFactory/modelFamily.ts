import type { DB } from "../db.ts";
import { findPrice, type ModelPrice } from "../pricing.ts";
import { isZeroPrice } from "./estimate.ts";

const FAMILIES: [string[], string][] = [
  [["claude"], "claude"],
  [["gpt", "chatgpt", "o1", "o3", "o4"], "openai"],
  [["gemini", "gemma"], "google"],
  [["llama"], "llama"],
  [["qwen", "qwq"], "qwen"],
  [["mistral", "mixtral", "ministral", "codestral"], "mistral"],
  [["deepseek"], "deepseek"],
  [["phi"], "phi"],
  [["grok"], "grok"],
  [["command"], "cohere"],
  [["demo"], "demo"],
];

/** Model family from the id, so a judge can be picked from another family. "unknown" is not one family. */
export function modelFamily(model: string): string {
  const id = model.toLowerCase().split("/").pop() ?? "";
  for (const [prefixes, family] of FAMILIES) {
    if (prefixes.some((p) => id.startsWith(p) && (p.length > 2 || id.length === p.length || !/[a-z]/.test(id[p.length] ?? "")))) return family;
  }
  return "unknown";
}

export type PriceStatus = { status: "priced" | "free" | "missing"; price: ModelPrice | null };

/** priced: the global price table has the model; free: a local Ollama model without a key; else missing. */
export function priceStatus(db: DB, provider: { kind: string; secret_id: number | null }, model: string): PriceStatus {
  const price = findPrice(db, model);
  if (price) return { status: isZeroPrice(price) ? "free" : "priced", price };
  if (provider.kind === "ollama" && !provider.secret_id) return { status: "free", price: null };
  return { status: "missing", price: null };
}
