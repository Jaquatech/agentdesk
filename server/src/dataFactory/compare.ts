import type { ReportCase, RunReport } from "./report.ts";

export type Change = "broke" | "fixed" | "same_fail" | "same_pass" | "unjudged";

export interface Side {
  provider_name: string; model: string; answers: number; errors: number; judged: number;
  pass_rate: number | null; avg_score: number | null; good_rate: number | null; avg_ms: number | null; cost_usd: number;
}

export interface CaseSide {
  status: "ok" | "error" | "missing"; answer: string; score: number | null; pass: boolean | null; reason: string; vote: "good" | "bad" | null;
}

export interface PairCase {
  case_key: string; change: Change; input: string; expected: string | null; a: CaseSide; b: CaseSide;
}

export interface Pair {
  label: string; a: Side; b: Side; shared: number; changed_input: number; only_a_cases: number; only_b_cases: number;
  counts: Record<Change, number>;
  cases: PairCase[];
}

type RunInfo = Pick<RunReport, "run" | "dataset" | "judge">;

export interface Comparison {
  schema_version: 1; generated_at: string; a: RunInfo; b: RunInfo; warnings: string[]; pairs: Pair[]; only_a: string[]; only_b: string[];
}

const ORDER: Change[] = ["broke", "fixed", "same_fail", "unjudged", "same_pass"];
const rate = (a: number, b: number) => (b === 0 ? null : a / b);
const modelName = (m: { provider_name: string; model: string }) => `${m.provider_name} / ${m.model}`;

function caseSide(c: ReportCase): CaseSide {
  const j = c.judge;
  return {
    status: c.status, answer: c.status === "error" ? c.error : c.answer, score: j?.status === "ok" ? j.score : null,
    pass: j?.status === "ok" ? j.pass : null, reason: j ? (j.status === "ok" ? j.reason : j.error) : "", vote: c.vote?.verdict ?? null,
  };
}

function changeOf(a: ReportCase, b: ReportCase): Change {
  if (a.judge?.status !== "ok" || b.judge?.status !== "ok" || a.judge.pass === null || b.judge.pass === null) return "unjudged";
  if (a.judge.pass === b.judge.pass) return a.judge.pass ? "same_pass" : "same_fail";
  return b.judge.pass ? "fixed" : "broke";
}

function sideFigures(m: { provider_name: string; model: string }, cases: ReportCase[]): Side {
  let answers = 0, errors = 0, judged = 0, passed = 0, voted = 0, good = 0, cost = 0;
  const ms: number[] = [];
  const scores: number[] = [];
  for (const c of cases) {
    if (c.status === "ok") { answers++; if (c.ms !== null) ms.push(c.ms); } else if (c.status === "error") errors++;
    if (c.cost_usd !== null) cost += c.cost_usd;
    if (c.judge?.status === "ok") {
      judged++;
      if (c.judge.pass) passed++;
      if (c.judge.score !== null) scores.push(c.judge.score);
    }
    if (c.vote) { voted++; if (c.vote.verdict === "good") good++; }
  }
  return {
    provider_name: m.provider_name, model: m.model, answers, errors, judged, pass_rate: rate(passed, judged),
    avg_score: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null, good_rate: rate(good, voted),
    avg_ms: ms.length ? Math.round(ms.reduce((s, x) => s + x, 0) / ms.length) : null, cost_usd: cost,
  };
}

function warningsOf(a: RunReport, b: RunReport): string[] {
  const w: string[] = [];
  if (a.dataset.id !== b.dataset.id) w.push("Different datasets");
  else if (a.dataset.version !== b.dataset.version) w.push(`Different dataset versions (v${a.dataset.version} and v${b.dataset.version})`);
  if (!a.judge) w.push("Run A is not judged");
  if (!b.judge) w.push("Run B is not judged");
  if (a.judge && b.judge) {
    if (a.judge.provider_name !== b.judge.provider_name || a.judge.model !== b.judge.model) w.push("Different judge models");
    if (a.judge.rubric !== b.judge.rubric) w.push("Different scoring guides");
  }
  if (a.run.system_prompt !== b.run.system_prompt) w.push("The system prompt differs");
  if (a.run.max_tokens !== b.run.max_tokens) w.push("The answer token limit differs");
  if (a.run.status !== "done") w.push(`Run A did not finish: ${a.run.status}`);
  if (b.run.status !== "done") w.push(`Run B did not finish: ${b.run.status}`);
  return w;
}

/** Two reports of the same project: A is before, B is after. Pure. */
export function compareReports(a: RunReport, b: RunReport): Comparison {
  const key = (m: { provider_name: string; model: string }) => `${m.provider_name}\u0000${m.model}`;
  const pairs: [typeof a.models[number], typeof b.models[number], string][] = [];
  const usedB = new Set<number>();
  for (const ma of a.models) {
    const mb = b.models.find((x) => !usedB.has(x.run_model_id) && key(x) === key(ma));
    if (mb) { usedB.add(mb.run_model_id); pairs.push([ma, mb, modelName(ma)]); }
  }
  if (pairs.length === 0 && a.models.length === 1 && b.models.length === 1) {
    pairs.push([a.models[0], b.models[0], `${a.models[0].model} → ${b.models[0].model}`]);
    usedB.add(b.models[0].run_model_id);
  }
  const usedA = new Set(pairs.map((p) => p[0].run_model_id));

  const out: Pair[] = pairs.map(([ma, mb, label]) => {
    const ca = a.cases.filter((c) => c.run_model_id === ma.run_model_id);
    const cb = new Map(b.cases.filter((c) => c.run_model_id === mb.run_model_id).map((c) => [c.case_key, c]));
    const keysA = new Set(ca.map((c) => c.case_key));
    const sharedA: ReportCase[] = [];
    const sharedB: ReportCase[] = [];
    const counts = { fixed: 0, broke: 0, same_pass: 0, same_fail: 0, unjudged: 0 };
    const cases: PairCase[] = [];
    let changedInput = 0, onlyA = 0;
    for (const x of ca) {
      const y = cb.get(x.case_key);
      if (!y) { onlyA++; continue; }
      if (x.input !== y.input) { changedInput++; continue; }
      sharedA.push(x);
      sharedB.push(y);
      const change = changeOf(x, y);
      counts[change]++;
      cases.push({ case_key: x.case_key, change, input: x.input, expected: x.expected, a: caseSide(x), b: caseSide(y) });
    }
    cases.sort((p, q) => ORDER.indexOf(p.change) - ORDER.indexOf(q.change));
    const onlyB = [...cb.keys()].filter((k) => !keysA.has(k)).length;
    return {
      label, a: sideFigures(ma, sharedA), b: sideFigures(mb, sharedB), shared: sharedA.length, changed_input: changedInput,
      only_a_cases: onlyA, only_b_cases: onlyB, counts, cases,
    };
  });

  const info = (r: RunReport): RunInfo => ({ run: r.run, dataset: r.dataset, judge: r.judge });
  return {
    schema_version: 1, generated_at: new Date().toISOString(), a: info(a), b: info(b), warnings: warningsOf(a, b), pairs: out,
    only_a: a.models.filter((m) => !usedA.has(m.run_model_id)).map(modelName),
    only_b: b.models.filter((m) => !usedB.has(m.run_model_id)).map(modelName),
  };
}
