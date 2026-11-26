/** Pure helpers for the Reports tab. The types mirror `server/src/dataFactory/report.ts`. */

export interface ReportModel {
  run_model_id: number; provider_name: string; model: string; family: string;
  answers: number; errors: number; missing: number; tokens_in: number; tokens_out: number; cost_usd: number; cost_unknown: number;
  avg_ms: number | null; p95_ms: number | null;
  judged: number; judge_errors: number; passed: number; avg_score: number | null; pass_rate: number | null;
  voted: number; good: number; good_rate: number | null;
  compared: number; agree: number; agreement: number | null; self_preference: boolean;
}

export interface ReportCase {
  run_model_id: number; provider_name: string; model: string; case_key: string; tags: string[];
  input: string; expected: string | null; answer: string;
  status: "ok" | "error" | "missing"; error: string;
  tokens_in: number; tokens_out: number; cost_usd: number | null; ms: number | null;
  judge: null | { status: "ok" | "error"; score: number | null; pass: boolean | null; reason: string; error: string };
  vote: null | { verdict: "good" | "bad"; note: string };
  agrees: boolean | null;
}

export interface RunReport {
  schema_version: 1;
  generated_at: string;
  run: {
    id: number; name: string; status: string; stop_reason: string; created_at: string; started_at: string | null; ended_at: string | null;
    system_prompt: string; max_tokens: number; cap_usd: number | null; est_low: number | null; est_high: number | null; cost_usd: number;
  };
  dataset: { id: number; name: string; version: number; sha256: string; case_count: number };
  judge: null | {
    id: number; provider_name: string; model: string; family: string; status: string; stop_reason: string; rubric: string; cost_usd: number; created_at: string;
  };
  models: ReportModel[];
  cases: ReportCase[];
}

export interface JudgeRunInfo { id: number; provider_name: string; model: string; status: string; created_at: string }
export interface ReportResponse { report: RunReport; markdown: string; judge_runs: JudgeRunInfo[] }

/** Wraps text in a backtick fence one longer than the longest backtick run inside it (at least three). */
export function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}markdown\n${text}\n${fence}`;
}

export function percent(n: number | null): string {
  return n === null || !Number.isFinite(n) ? "-" : `${Math.round(n * 100)}%`;
}

export function seconds(ms: number | null): string {
  return ms === null || !Number.isFinite(ms) ? "-" : `${(ms / 1000).toFixed(1)} s`;
}

/** The three problem lists of a report. A failed case voted good is in `failed` and in `disagreements`. */
export function problems(cases: ReportCase[]): { failed: ReportCase[]; errors: ReportCase[]; disagreements: ReportCase[] } {
  return {
    failed: cases.filter((c) => c.judge?.status === "ok" && c.judge.pass === false),
    errors: cases.filter((c) => c.status === "error"),
    disagreements: cases.filter((c) => c.agrees === false),
  };
}

/** Answers that are ok and have no vote. */
export function unvoted(report: RunReport): number {
  return report.cases.filter((c) => c.status === "ok" && c.vote === null).length;
}

export function reportUrl(runId: number, ext: string, judgeId: number | null, all: boolean): string {
  return `/api/eval-runs/${runId}/report.${ext}?${judgeId !== null ? `judge=${judgeId}&` : ""}all=${all ? 1 : 0}`;
}
