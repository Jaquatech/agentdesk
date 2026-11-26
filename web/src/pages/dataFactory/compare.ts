/** Pure helpers for comparing two runs. The types mirror `server/src/dataFactory/compare.ts`. */
import type { JudgeRunInfo, RunReport } from "./report.ts";

export type Change = "broke" | "fixed" | "same_fail" | "same_pass" | "unjudged";

export interface CompareSide {
  provider_name: string; model: string; answers: number; errors: number; judged: number;
  pass_rate: number | null; avg_score: number | null; good_rate: number | null; avg_ms: number | null; cost_usd: number;
}
export interface CompareCaseSide {
  status: "ok" | "error" | "missing"; answer: string; score: number | null; pass: boolean | null; reason: string; vote: "good" | "bad" | null;
}
export interface PairCase { case_key: string; change: Change; input: string; expected: string | null; a: CompareCaseSide; b: CompareCaseSide }
export interface Pair {
  label: string; a: CompareSide; b: CompareSide; shared: number; changed_input: number; only_a_cases: number; only_b_cases: number;
  counts: Record<Change, number>; cases: PairCase[];
}
type RunInfo = Pick<RunReport, "run" | "dataset" | "judge">;
export interface Comparison {
  schema_version: 1; generated_at: string; a: RunInfo; b: RunInfo; warnings: string[]; pairs: Pair[]; only_a: string[]; only_b: string[];
}
export interface CompareResponse { compare: Comparison; markdown: string; judge_runs_a: JudgeRunInfo[]; judge_runs_b: JudgeRunInfo[] }

export type CaseFilter = "changed" | "broke" | "fixed" | "all";
export const CASE_FILTERS: { value: CaseFilter; label: string }[] = [
  { value: "changed", label: "Changed" }, { value: "broke", label: "Broke" }, { value: "fixed", label: "Fixed" }, { value: "all", label: "All" },
];

/** The older run (lower id) is A unless swapped. */
export function orderSides(openId: number, otherId: number, swapped: boolean): { a: number; b: number } {
  const [a, b] = openId < otherId ? [openId, otherId] : [otherId, openId];
  return swapped ? { a: b, b: a } : { a, b };
}

export function countsText(c: Record<Change, number>): string {
  return `${c.broke} broke, ${c.fixed} fixed, ${c.same_pass} passed in both, ${c.same_fail} failed in both, ${c.unjudged} not judged`;
}

export function changeWord(change: Change): string {
  switch (change) {
    case "broke": return "Broke";
    case "fixed": return "Fixed";
    case "same_pass": return "Passed both";
    case "same_fail": return "Failed both";
    case "unjudged": return "Not judged";
  }
}

export function filterCases(cases: PairCase[], filter: CaseFilter): PairCase[] {
  if (filter === "all") return cases;
  if (filter === "changed") return cases.filter((c) => c.change === "broke" || c.change === "fixed");
  return cases.filter((c) => c.change === filter);
}

export function compareUrl(ext: string, a: number, b: number, judgeA: number | null, judgeB: number | null): string {
  const q = [`a=${a}`, `b=${b}`];
  if (judgeA !== null) q.push(`judge_a=${judgeA}`);
  if (judgeB !== null) q.push(`judge_b=${judgeB}`);
  return `/api/eval-compare.${ext}?${q.join("&")}`;
}
