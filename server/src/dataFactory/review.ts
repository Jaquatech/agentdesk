import type { DB } from "../db.ts";

export interface Vote { verdict: "good" | "bad"; note: string }
export interface Judge { score: number | null; pass: boolean; reason: string; judge_model: string }
export interface ReviewItem {
  result_id: number; case_key: string; provider_name: string; model: string; input: string; answer: string;
  vote: Vote | null; expected: string | null; judge: Judge | null; agrees: boolean | null;
}

/**
 * The judgement that counts for a result: status `ok`, from the judge run with the highest id that has one.
 * The result id is the only parameter.
 */
const JUDGE_OF_RESULT = `
  SELECT g.score, g.pass, g.reason, j.model AS judge_model
  FROM eval_judgements g JOIN eval_judge_runs j ON j.id = g.judge_run_id
  WHERE g.result_id = ? AND g.status = 'ok' ORDER BY g.judge_run_id DESC LIMIT 1`;

/** A judge `pass` agrees with a vote `good`, `fail` with `bad`; null when nothing judged the result. */
export const agreement = (verdict: string, pass: boolean | null): boolean | null =>
  pass === null ? null : pass === (verdict === "good");

export function judgeOf(db: DB, resultId: number): Judge | null {
  const g = db.prepare(JUDGE_OF_RESULT).get(resultId) as { score: number | null; pass: number | null; reason: string; judge_model: string } | undefined;
  return g ? { score: g.score, pass: g.pass === 1, reason: g.reason, judge_model: g.judge_model } : null;
}

interface Row {
  result_id: number; case_key: string; provider_name: string; model: string; input: string; answer: string; expected: string | null;
  verdict: "good" | "bad" | null; note: string | null;
}

/** Builds the item for a result row. An unvoted item never carries the reference answer or the judgement. */
function reviewItem(db: DB, r: Row): ReviewItem {
  const base = { result_id: r.result_id, case_key: r.case_key, provider_name: r.provider_name, model: r.model, input: r.input, answer: r.answer };
  if (r.verdict === null) return { ...base, vote: null, expected: null, judge: null, agrees: null };
  const judge = judgeOf(db, r.result_id);
  return { ...base, vote: { verdict: r.verdict, note: r.note ?? "" }, expected: r.expected, judge, agrees: judge ? agreement(r.verdict, judge.pass) : null };
}

const ITEM_SELECT = `
  SELECT r.id AS result_id, r.case_key, m.provider_name, m.model, c.input, c.expected, r.answer, v.verdict, v.note
  FROM eval_results r
  JOIN eval_run_models m ON m.id = r.run_model_id
  JOIN eval_cases c ON c.id = r.case_id
  LEFT JOIN eval_votes v ON v.result_id = r.id`;

export function itemOf(db: DB, resultId: number): ReviewItem | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE r.id = ?`).get(resultId) as Row | undefined;
  return r ? reviewItem(db, r) : null;
}

export function reviewList(db: DB, runId: number, modelId: number | null, unvoted: boolean, offset: number, limit: number) {
  const where = `r.run_id = ? AND r.status = 'ok' AND (? IS NULL OR r.run_model_id = ?)`;
  const t = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(v.id IS NOT NULL), 0) AS voted FROM eval_results r LEFT JOIN eval_votes v ON v.result_id = r.id WHERE ${where}`)
    .get(runId, modelId, modelId) as { total: number; voted: number };
  const rows = db.prepare(`${ITEM_SELECT} WHERE ${where} AND (? = 0 OR v.id IS NULL) ORDER BY r.id LIMIT ? OFFSET ?`)
    .all(runId, modelId, modelId, unvoted ? 1 : 0, limit, offset) as unknown as Row[];
  return { total: t.total, voted: t.voted, items: rows.map((r) => reviewItem(db, r)) };
}

type Counts = { answers: number; voted: number; good: number; bad: number; compared: number; agree: number };

export function reviewSummary(db: DB, runId: number) {
  const rows = db.prepare(`
    SELECT m.id AS run_model_id, m.provider_name, m.model, r.id AS result_id, v.verdict
    FROM eval_run_models m
    LEFT JOIN eval_results r ON r.run_model_id = m.id AND r.status = 'ok'
    LEFT JOIN eval_votes v ON v.result_id = r.id
    WHERE m.run_id = ? ORDER BY m.id, r.id`).all(runId) as unknown as
    { run_model_id: number; provider_name: string; model: string; result_id: number | null; verdict: "good" | "bad" | null }[];
  const models = new Map<number, { run_model_id: number; provider_name: string; model: string } & Counts>();
  for (const r of rows) {
    let m = models.get(r.run_model_id);
    if (!m) { m = { run_model_id: r.run_model_id, provider_name: r.provider_name, model: r.model, answers: 0, voted: 0, good: 0, bad: 0, compared: 0, agree: 0 }; models.set(r.run_model_id, m); }
    if (r.result_id === null) continue;
    m.answers++;
    if (r.verdict === null) continue;
    m.voted++;
    if (r.verdict === "good") m.good++; else m.bad++;
    const j = judgeOf(db, r.result_id);
    if (j) { m.compared++; if (agreement(r.verdict, j.pass)) m.agree++; }
  }
  const rate = (a: number, b: number) => (b === 0 ? null : a / b);
  const per = [...models.values()].map((m) => ({ ...m, good_rate: rate(m.good, m.voted), agreement: rate(m.agree, m.compared) }));
  const sum = (k: keyof Counts) => per.reduce((s, m) => s + m[k], 0);
  const totals: Counts = { answers: sum("answers"), voted: sum("voted"), good: sum("good"), bad: sum("bad"), compared: sum("compared"), agree: sum("agree") };
  return { ...totals, good_rate: rate(totals.good, totals.voted), agreement: rate(totals.agree, totals.compared), models: per };
}
