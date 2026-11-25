/** Pure helpers for the Judge tab. */

export type Verdict = "all" | "pass" | "fail";
export type JudgeSummaryRow = { judged: number; avg_score: number | null; pass_rate: number | null; errors: number };

const ENDED = new Set(["done", "stopped", "failed", "interrupted"]);

/** A run that is over: it can be judged (when it has answers). */
export function hasEnded(status: string): boolean {
  return ENDED.has(status);
}

/** The runs that can be judged: ended, with at least one answer. Order is kept. */
export function judgeableRuns<T extends { status: string; answers: number }>(runs: T[]): T[] {
  return runs.filter((r) => hasEnded(r.status) && r.answers > 0);
}

/** Average score with one decimal; `-` when nothing was judged. */
export function averageText(avg: number | null | undefined, judged: number): string {
  if (judged <= 0 || avg === null || avg === undefined || !Number.isFinite(avg)) return "-";
  return avg.toFixed(1);
}

/** Pass rate (0 to 1) as a whole percent; `-` when nothing was judged. */
export function passRateText(rate: number | null | undefined, judged: number): string {
  if (judged <= 0 || rate === null || rate === undefined || !Number.isFinite(rate)) return "-";
  return `${Math.round(rate * 100)}%`;
}

/** The average over all models of a judge run, weighted by how many answers each had. */
export function overallAverage(summary: JudgeSummaryRow[]): string {
  const judged = summary.reduce((n, s) => n + s.judged, 0);
  if (judged === 0) return "-";
  const total = summary.reduce((n, s) => n + (s.avg_score ?? 0) * s.judged, 0);
  return averageText(total / judged, judged);
}

/** `4 of 5`, or `-` without a score. */
export function scoreLabel(score: number | null | undefined): string {
  return score === null || score === undefined ? "-" : `${score} of 5`;
}

/** Words, not colour alone: Pass, Fail, or Error when the judge call failed. */
export function verdictLabel(status: string, pass: number | null | undefined): string {
  if (status === "error") return "Error";
  return pass === 1 ? "Pass" : "Fail";
}

/** The query part for the verdict filter: empty for All. */
export function verdictQuery(v: Verdict | string): string {
  return v === "pass" || v === "fail" ? `&verdict=${v}` : "";
}

/** A filter value from a select, `all` when it is not one of the three. */
export function verdictFrom(v: string): Verdict {
  return v === "pass" || v === "fail" ? v : "all";
}
