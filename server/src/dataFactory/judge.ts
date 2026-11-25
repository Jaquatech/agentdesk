import { callCost, type ModelPrice } from "../pricing.ts";
import { estimateTokens, isZeroPrice } from "./estimate.ts";
import { modelFamily } from "./modelFamily.ts";

/* Judge calls: the rubric, the messages, reading the reply, picking a judge model, and the cost estimate. Pure, no database. */

export const DEFAULT_RUBRIC =
  "You are a strict grader. Compare the model answer with the reference answer when there is one; otherwise judge it against the question. " +
  "Judge correctness first, then completeness, then clarity. Never reward length. " +
  "Scores: 5 = right and complete, 4 = right with a small gap, 3 = partly right, 2 = mostly wrong, 1 = wrong or unrelated. " +
  "Pass means score 4 or 5.";

export const FORMAT_LINE =
  'Reply with one JSON object and nothing else: {"score": 1-5, "pass": true|false, "reason": "one or two sentences"}';

const PART_CHARS = 6000;
const REASON_CHARS = 1000;
const CUT = "\n[cut]";

export function judgeSystem(rubric: string): string {
  const text = rubric.trim() === "" ? DEFAULT_RUBRIC : rubric.trim();
  return `${text}\n\n${FORMAT_LINE}`;
}

const cut = (s: string) => (s.length > PART_CHARS ? s.slice(0, PART_CHARS) + CUT : s);

export function judgeUser(p: { input: string; expected: string | null; answer: string }): string {
  const ref = p.expected && p.expected.trim() !== "" ? `Reference answer:\n${cut(p.expected)}` : "No reference answer was given.";
  return `Question:\n${cut(p.input)}\n\n${ref}\n\nModel answer:\n${cut(p.answer)}`;
}

export type Judgement = { ok: true; score: number; pass: boolean; reason: string } | { ok: false; error: string };

export function parseJudgement(text: string): Judgement {
  const bad = (): Judgement => ({ ok: false, error: `Could not read a judgement: ${text.slice(0, 200)}` });
  const start = text.indexOf("{");
  const end = text.indexOf("}", start + 1);
  if (start < 0 || end < 0) return bad();
  let o: unknown;
  try { o = JSON.parse(text.slice(start, end + 1)); } catch { return bad(); }
  if (!o || typeof o !== "object") return bad();
  const r = o as Record<string, unknown>;
  const raw = typeof r.score === "number" ? r.score : typeof r.score === "string" && r.score.trim() !== "" ? Number(r.score) : NaN;
  const score = Math.round(raw);
  if (!Number.isFinite(raw) || score < 1 || score > 5) return { ok: false, error: `The score must be 1 to 5: ${text.slice(0, 200)}` };
  const pass = typeof r.pass === "boolean" ? r.pass : score >= 4;
  const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, REASON_CHARS) : "";
  return { ok: true, score, pass, reason };
}

export type JudgeModel = { id: number; provider_id: number; provider_name: string; model: string; family: string };

export function judgeOptions<T extends { family: string }>(models: T[], testedFamilies: string[]): { models: (T & { same_family: boolean })[]; warning: string | null } {
  const tested = new Set(testedFamilies.filter((f) => f !== "unknown"));
  const marked = models.map((m) => ({ ...m, same_family: m.family !== "unknown" && tested.has(m.family) }));
  const sorted = [...marked.filter((m) => !m.same_family), ...marked.filter((m) => m.same_family)];
  const warning = marked.length > 0 && marked.every((m) => m.same_family)
    ? "Every judge model is from the same family as a tested model; a model tends to rate its own family higher."
    : null;
  return { models: sorted, warning };
}

export type JudgeEstimate = {
  calls: number; low: number; high: number; status: "priced" | "free" | "missing"; needs_cap: boolean; over_cap: boolean;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function estimateJudge(p: {
  results: { input: string; expected: string | null; answer: string; status?: string }[];
  rubric: string; maxTokens: number; price: ModelPrice | null; free: boolean; capUsd?: number | null;
}): JudgeEstimate {
  const results = p.results.filter((r) => r.status === undefined || r.status === "ok");
  const status = p.free || (p.price && isZeroPrice(p.price)) ? "free" : p.price ? "priced" : "missing";
  const system = judgeSystem(p.rubric);
  let low = 0, high = 0;
  if (status === "priced" && p.price) {
    for (const r of results) {
      const text = judgeUser(r);
      const inLow = estimateTokens(system, 4) + estimateTokens(text, 4);
      const inHigh = estimateTokens(system, 3) + estimateTokens(text, 3);
      low += callCost(p.price, { input: inLow, output: Math.min(40, p.maxTokens), cacheRead: 0, cacheWrite: 0 });
      high += callCost(p.price, { input: inHigh, output: p.maxTokens, cacheRead: 0, cacheWrite: 0 });
    }
  }
  low = round6(low);
  high = round6(high);
  const cap = p.capUsd ?? null;
  return { calls: results.length, low, high, status, needs_cap: cap === null && status === "priced", over_cap: cap !== null && high > cap };
}

export { modelFamily };
