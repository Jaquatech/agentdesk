import type { DB } from "../db.ts";
import type { Vault } from "../crypto.ts";
import { evalCall } from "./evalCall.ts";
import { DEFAULT_RUBRIC, estimateJudge, judgeSystem, judgeUser, parseJudgement, type JudgeEstimate } from "./judge.ts";
import { priceStatus } from "./modelFamily.ts";
import { MAX_ERRORS_IN_ROW, MAX_IN_FLIGHT } from "./runner.ts";

/** Tokens a judge reply may use. */
export const JUDGE_MAX_TOKENS = 300;

type ResultRow = { id: number; case_id: number; case_key: string; answer: string };
type CaseText = { input: string; expected: string | null };
type JudgeModelRow = { id: number; provider_id: number; provider_name: string; provider_kind: string; secret_id: number | null; model: string };

export type JudgeStart = { ok: true; id: number } | { ok: false; status: number; error: string };

const controllers = new Map<number, AbortController>();
const finished = new Map<number, Promise<void>>();

const money = (n: number) => n.toFixed(2);

/** The rubric a judge run would use: the project's own, or the default. */
export function rubricOf(db: DB, projectId: number): string {
  const row = db.prepare("SELECT rubric FROM eval_judge_config WHERE project_id = ?").get(projectId) as { rubric: string } | undefined;
  return row && row.rubric.trim() !== "" ? row.rubric : DEFAULT_RUBRIC;
}

/** The scripted judge of the demo: 5 for the expected answer, 2 for another, 4 when there is no expected answer. */
export function demoJudgeReply(expected: string | null, answer: string): string {
  if (expected === null || expected.trim() === "") return JSON.stringify({ score: 4, pass: true, reason: "No reference answer; the answer reads well." });
  if (answer === expected) return JSON.stringify({ score: 5, pass: true, reason: "Matches the reference answer." });
  return JSON.stringify({ score: 2, pass: false, reason: "Does not match the reference answer." });
}

/** Judge runs that were `running` when the server stopped cannot go on. */
export function interruptJudges(db: DB) {
  db.prepare(`UPDATE eval_judge_runs SET status = 'interrupted', stop_reason = 'The server was restarted.', ended_at = datetime('now') WHERE status = 'running'`).run();
}

/** Resolves when the background work of a judge run has ended (for tests). */
export function judgeFinished(id: number): Promise<void> {
  return finished.get(id) ?? Promise.resolve();
}

const okResults = (db: DB, runId: number) =>
  db.prepare("SELECT id, case_id, case_key, answer FROM eval_results WHERE run_id = ? AND status = 'ok' ORDER BY id").all(runId) as ResultRow[];

/** The judge model when it is one of the project's judge models. */
export function judgeModelOf(db: DB, projectId: number, evalModelId: number): JudgeModelRow | undefined {
  return db.prepare(`
    SELECT m.id, m.provider_id, p.name AS provider_name, p.kind AS provider_kind, p.secret_id, m.model
    FROM eval_models m JOIN providers p ON p.id = m.provider_id
    WHERE m.id = ? AND m.project_id = ? AND m.for_judge = 1`).get(evalModelId, projectId) as JudgeModelRow | undefined;
}

/** Estimate for judging the ok results of a run. */
export function estimateFor(db: DB, runId: number, projectId: number, m: JudgeModelRow, capUsd: number | null): JudgeEstimate {
  const cases = new Map<number, CaseText>();
  const results = okResults(db, runId).map((r) => {
    let c = cases.get(r.case_id);
    if (!c) { c = caseOf(db, r.case_id); cases.set(r.case_id, c); }
    return { input: c.input, expected: c.expected, answer: r.answer };
  });
  const s = priceStatus(db, { kind: m.provider_kind, secret_id: m.secret_id }, m.model);
  return estimateJudge({ results, rubric: rubricOf(db, projectId), maxTokens: JUDGE_MAX_TOKENS, price: s.price, free: s.status === "free", capUsd });
}

const caseOf = (db: DB, caseId: number): CaseText =>
  (db.prepare("SELECT input, expected FROM eval_cases WHERE id = ?").get(caseId) as CaseText | undefined) ?? { input: "", expected: null };

export function startJudge(db: DB, vault: Vault, runId: number, o: { evalModelId: number; capUsd: number | null; confirmOverCap: boolean }): JudgeStart {
  const run = db.prepare("SELECT id, project_id, status FROM eval_runs WHERE id = ?").get(runId) as { id: number; project_id: number; status: string } | undefined;
  if (!run) return { ok: false, status: 404, error: "No such run" };
  const m = judgeModelOf(db, run.project_id, o.evalModelId);
  if (!m) return { ok: false, status: 400, error: "Choose one of the judge models of this project" };
  if (run.status === "planned" || run.status === "running") return { ok: false, status: 409, error: "Judge a run after it has ended" };
  const results = okResults(db, runId);
  if (results.length === 0) return { ok: false, status: 409, error: "This run has no answers to judge" };
  if (db.prepare("SELECT id FROM eval_judge_runs WHERE status = 'running'").get()) return { ok: false, status: 409, error: "Another judge run is in progress" };

  const est = estimateFor(db, runId, run.project_id, m, o.capUsd);
  if (est.status === "missing") return { ok: false, status: 400, error: `No price for ${m.model}. Set a price on the Models tab.` };
  if (est.needs_cap) return { ok: false, status: 400, error: "Set a cost cap for this run" };
  if (est.over_cap && !o.confirmOverCap)
    return { ok: false, status: 409, error: `The estimate is up to $${money(est.high)}, above the cap of $${money(o.capUsd ?? 0)}. Start anyway to confirm.` };

  const rubric = rubricOf(db, run.project_id);
  const id = Number(db.prepare(`INSERT INTO eval_judge_runs (run_id, provider_id, provider_name, model, rubric, max_tokens, cap_usd, est_low, est_high)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, m.provider_id, m.provider_name, m.model, rubric, JUDGE_MAX_TOKENS, o.capUsd, est.low, est.high).lastInsertRowid);
  const controller = new AbortController();
  controllers.set(id, controller);
  finished.set(id, execute(db, vault, id, run.project_id, m, rubric, o.capUsd, results, controller).finally(() => { controllers.delete(id); }));
  return { ok: true, id };
}

/** Stops a running judge run now. False when it is not running. */
export function stopJudge(db: DB, id: number): boolean {
  const c = controllers.get(id);
  if (!c || c.signal.aborted) return false;
  halt(db, id, c, "stopped", "Stopped by you.");
  return true;
}

/** Ends the judge run at once; calls in flight are aborted and no new call starts. The first reason wins. */
function halt(db: DB, id: number, c: AbortController, status: "stopped" | "failed", reason: string) {
  if (c.signal.aborted) return;
  db.prepare("UPDATE eval_judge_runs SET status = ?, stop_reason = ?, ended_at = datetime('now') WHERE id = ?").run(status, reason, id);
  c.abort();
}

async function execute(db: DB, vault: Vault, id: number, projectId: number, m: JudgeModelRow, rubric: string, capUsd: number | null, results: ResultRow[], c: AbortController): Promise<void> {
  const system = judgeSystem(rubric);
  let next = 0;
  let streak = 0;

  const worker = async () => {
    while (!c.signal.aborted && next < results.length) {
      const r = results[next++];
      const cs = caseOf(db, r.case_id);
      const call = await evalCall(db, vault, {
        projectId, providerId: m.provider_id, model: m.model, system, prompt: judgeUser({ input: cs.input, expected: cs.expected, answer: r.answer }),
        maxTokens: JUDGE_MAX_TOKENS, signal: c.signal, caseKey: r.case_key, kind: "judge", demoReply: demoJudgeReply(cs.expected, r.answer),
      });
      if (!call.ok && call.budget) { halt(db, id, c, "stopped", call.error); continue; }
      // A call that was aborted by a stop leaves no row.
      if (!call.ok && c.signal.aborted) continue;
      const j = call.ok ? parseJudgement(call.answer) : null;
      const error = !call.ok ? call.error : j && !j.ok ? j.error : "";
      try {
        db.prepare(`INSERT INTO eval_judgements (judge_run_id, result_id, score, pass, reason, status, error, tokens_in, tokens_out, cost_usd, ms, usage_run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, r.id, j?.ok ? j.score : null, j?.ok ? (j.pass ? 1 : 0) : null, j?.ok ? j.reason : "", error ? "error" : "ok", error.slice(0, 2000),
            call.tokensIn, call.tokensOut, call.costUsd, call.ms, call.usageRunId);
        db.prepare("UPDATE eval_judge_runs SET cost_usd = cost_usd + ? WHERE id = ?").run(call.costUsd ?? 0, id);
      } catch {
        // The judge run or the result was deleted while a call was in flight.
        continue;
      }
      streak = error ? streak + 1 : 0;
      if (error && streak >= MAX_ERRORS_IN_ROW)
        halt(db, id, c, "failed", `${m.model} failed ${MAX_ERRORS_IN_ROW} times in a row. Last error: ${error.slice(0, 300)}`);
      const spent = (db.prepare("SELECT cost_usd FROM eval_judge_runs WHERE id = ?").get(id) as { cost_usd: number } | undefined)?.cost_usd ?? 0;
      if (capUsd !== null && spent >= capUsd) halt(db, id, c, "stopped", `Cost cap reached ($${money(spent)} of $${money(capUsd)}).`);
    }
  };

  try {
    await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, worker));
  } catch (err) {
    halt(db, id, c, "failed", String((err as Error)?.message ?? err));
  }
  if (!c.signal.aborted) db.prepare("UPDATE eval_judge_runs SET status = 'done', ended_at = datetime('now') WHERE id = ?").run(id);
}
