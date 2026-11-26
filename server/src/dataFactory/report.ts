import type { DB } from "../db.ts";
import { modelFamily } from "./modelFamily.ts";
import { agreement } from "./review.ts";

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

/** Every judge run of a run, newest first. */
export function judgeRunsOf(db: DB, runId: number): JudgeRunInfo[] {
  return db.prepare("SELECT id, provider_name, model, status, created_at FROM eval_judge_runs WHERE run_id = ? ORDER BY id DESC").all(runId) as unknown as JudgeRunInfo[];
}

/** The judge run with the highest id that has at least one ok judgement; null when none. */
export function defaultJudgeRun(db: DB, runId: number): number | null {
  const r = db.prepare(`SELECT j.id FROM eval_judge_runs j WHERE j.run_id = ?
    AND EXISTS (SELECT 1 FROM eval_judgements g WHERE g.judge_run_id = j.id AND g.status = 'ok') ORDER BY j.id DESC LIMIT 1`).get(runId) as { id: number } | undefined;
  return r?.id ?? null;
}

const rate = (a: number, b: number) => (b === 0 ? null : a / b);

function parseTags(raw: string): string[] {
  try {
    const t = JSON.parse(raw) as unknown;
    return Array.isArray(t) ? t.map(String) : [];
  } catch { return []; }
}

interface ResultRow {
  run_model_id: number; case_id: number; answer: string; status: "ok" | "error"; error: string;
  tokens_in: number; tokens_out: number; cost_usd: number | null; ms: number;
  verdict: "good" | "bad" | null; note: string | null;
  g_status: "ok" | "error" | null; g_score: number | null; g_pass: number | null; g_reason: string | null; g_error: string | null;
}

interface RunRow {
  id: number; name: string; status: string; stop_reason: string; created_at: string; started_at: string | null; ended_at: string | null;
  system_prompt: string; max_tokens: number; cap_usd: number | null; est_low: number | null; est_high: number | null; cost_usd: number;
  version_id: number; dataset_id: number; dataset_name: string; version: number; sha256: string; case_count: number;
}

interface JudgeRunRow {
  id: number; provider_name: string; model: string; status: string; stop_reason: string; rubric: string; cost_usd: number; created_at: string;
}

/** Reads only. `judgeRunId` is a judge run of this run, or null for no judging. */
export function buildReport(db: DB, runId: number, judgeRunId: number | null): RunReport {
  const run = db.prepare(`SELECT r.*, d.id AS dataset_id, d.name AS dataset_name, v.version, v.sha256, v.case_count
    FROM eval_runs r JOIN eval_dataset_versions v ON v.id = r.version_id JOIN eval_datasets d ON d.id = v.dataset_id WHERE r.id = ?`).get(runId) as unknown as RunRow;
  const judgeRow = judgeRunId === null ? undefined
    : db.prepare("SELECT * FROM eval_judge_runs WHERE id = ? AND run_id = ?").get(judgeRunId, runId) as unknown as JudgeRunRow | undefined;
  const judge = judgeRow
    ? { id: judgeRow.id, provider_name: judgeRow.provider_name, model: judgeRow.model, family: modelFamily(judgeRow.model), status: judgeRow.status,
        stop_reason: judgeRow.stop_reason, rubric: judgeRow.rubric, cost_usd: judgeRow.cost_usd, created_at: judgeRow.created_at }
    : null;

  const runModels = db.prepare("SELECT id, provider_name, model FROM eval_run_models WHERE run_id = ? ORDER BY id").all(runId) as unknown as
    { id: number; provider_name: string; model: string }[];
  const dsCases = db.prepare("SELECT id, case_key, input, expected, tags FROM eval_cases WHERE version_id = ? ORDER BY position, id").all(run.version_id) as unknown as
    { id: number; case_key: string; input: string; expected: string | null; tags: string }[];
  const rows = db.prepare(`SELECT r.run_model_id, r.case_id, r.answer, r.status, r.error, r.tokens_in, r.tokens_out, r.cost_usd, r.ms,
      v.verdict, v.note, g.status AS g_status, g.score AS g_score, g.pass AS g_pass, g.reason AS g_reason, g.error AS g_error
    FROM eval_results r
    LEFT JOIN eval_votes v ON v.result_id = r.id
    LEFT JOIN eval_judgements g ON g.result_id = r.id AND g.judge_run_id = ?
    WHERE r.run_id = ?`).all(judgeRunId, runId) as unknown as ResultRow[];
  const byKey = new Map(rows.map((r) => [`${r.run_model_id}:${r.case_id}`, r]));

  const cases: ReportCase[] = [];
  const models: ReportModel[] = [];
  for (const m of runModels) {
    const answerMs: number[] = [];
    const scores: number[] = [];
    const mm: ReportModel = {
      run_model_id: m.id, provider_name: m.provider_name, model: m.model, family: modelFamily(m.model),
      answers: 0, errors: 0, missing: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_unknown: 0, avg_ms: null, p95_ms: null,
      judged: 0, judge_errors: 0, passed: 0, avg_score: null, pass_rate: null, voted: 0, good: 0, good_rate: null,
      compared: 0, agree: 0, agreement: null, self_preference: false,
    };
    for (const c of dsCases) {
      const r = byKey.get(`${m.id}:${c.id}`);
      const base = { run_model_id: m.id, provider_name: m.provider_name, model: m.model, case_key: c.case_key, tags: parseTags(c.tags), input: c.input, expected: c.expected };
      if (!r) {
        mm.missing++;
        cases.push({ ...base, answer: "", status: "missing", error: "", tokens_in: 0, tokens_out: 0, cost_usd: null, ms: null, judge: null, vote: null, agrees: null });
        continue;
      }
      if (r.status === "ok") { mm.answers++; answerMs.push(r.ms); } else mm.errors++;
      mm.tokens_in += r.tokens_in;
      mm.tokens_out += r.tokens_out;
      if (r.cost_usd === null) mm.cost_unknown++; else mm.cost_usd += r.cost_usd;

      let cj: ReportCase["judge"] = null;
      if (r.g_status) {
        const pass = r.g_pass === null ? null : r.g_pass === 1;
        cj = { status: r.g_status, score: r.g_score, pass: r.g_status === "ok" ? pass : null, reason: r.g_reason ?? "", error: r.g_error ?? "" };
        if (r.g_status === "ok") {
          mm.judged++;
          if (pass) mm.passed++;
          if (r.g_score !== null) scores.push(r.g_score);
        } else mm.judge_errors++;
      }
      const vote = r.verdict ? { verdict: r.verdict, note: r.note ?? "" } : null;
      if (vote) { mm.voted++; if (vote.verdict === "good") mm.good++; }
      let agrees: boolean | null = null;
      if (vote && cj && cj.status === "ok") {
        agrees = agreement(vote.verdict, cj.pass);
        if (agrees !== null) { mm.compared++; if (agrees) mm.agree++; }
      }
      cases.push({ ...base, answer: r.answer, status: r.status, error: r.error, tokens_in: r.tokens_in, tokens_out: r.tokens_out, cost_usd: r.cost_usd, ms: r.ms, judge: cj, vote, agrees });
    }
    if (answerMs.length) {
      const sorted = [...answerMs].sort((a, b) => a - b);
      mm.avg_ms = Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length);
      mm.p95_ms = sorted[Math.ceil(0.95 * sorted.length) - 1];
    }
    mm.avg_score = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
    mm.pass_rate = rate(mm.passed, mm.judged);
    mm.good_rate = rate(mm.good, mm.voted);
    mm.agreement = rate(mm.agree, mm.compared);
    mm.self_preference = judge !== null && mm.family === judge.family && mm.family !== "unknown";
    models.push(mm);
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run: {
      id: run.id, name: run.name, status: run.status, stop_reason: run.stop_reason, created_at: run.created_at, started_at: run.started_at, ended_at: run.ended_at,
      system_prompt: run.system_prompt, max_tokens: run.max_tokens, cap_usd: run.cap_usd, est_low: run.est_low, est_high: run.est_high, cost_usd: run.cost_usd,
    },
    dataset: { id: run.dataset_id, name: run.dataset_name, version: run.version, sha256: run.sha256, case_count: run.case_count },
    judge, models, cases,
  };
}
