import type { DB } from "../db.ts";
import type { Vault } from "../crypto.ts";
import { evalCall } from "./evalCall.ts";
import { estimateFor } from "./runPlans.ts";

/** Calls in flight at the same time in one run. */
export const MAX_IN_FLIGHT = 2;
/** Errors in a row on one model that fail the run. */
export const MAX_ERRORS_IN_ROW = 5;

type RunRow = { id: number; project_id: number; version_id: number; system_prompt: string; max_tokens: number; cap_usd: number | null; status: string };
type RunModel = { id: number; provider_id: number | null; provider_name: string; model: string };
type CaseRow = { id: number; case_key: string; input: string; expected: string | null };

export type StartResult = { ok: true } | { ok: false; status: number; error: string };

const controllers = new Map<number, AbortController>();
const finished = new Map<number, Promise<void>>();

const money = (n: number) => n.toFixed(2);

/** Runs that were `running` when the server stopped cannot go on. */
export function interruptRunning(db: DB) {
  db.prepare(`UPDATE eval_runs SET status = 'interrupted', stop_reason = 'The server was restarted.', ended_at = datetime('now') WHERE status = 'running'`).run();
}

/** Resolves when the background work of a run has ended (for tests). */
export function runFinished(runId: number): Promise<void> {
  return finished.get(runId) ?? Promise.resolve();
}

export function startRun(db: DB, vault: Vault, runId: number, confirmOverCap: boolean): StartResult {
  const run = db.prepare("SELECT id, project_id, version_id, system_prompt, max_tokens, cap_usd, status FROM eval_runs WHERE id = ?").get(runId) as RunRow | undefined;
  if (!run) return { ok: false, status: 404, error: "No such run" };
  if (run.status !== "planned") return { ok: false, status: 409, error: "Only a planned run can be started" };
  if (db.prepare("SELECT id FROM eval_runs WHERE status = 'running'").get()) return { ok: false, status: 409, error: "Another run is in progress" };

  const models = db.prepare("SELECT id, provider_id, provider_name, model FROM eval_run_models WHERE run_id = ? ORDER BY id").all(runId) as RunModel[];
  const est = estimateFor(db, run.version_id, { systemPrompt: run.system_prompt, maxTokens: run.max_tokens, capUsd: run.cap_usd }, models);
  if (est.missing.length) return { ok: false, status: 400, error: `No price for ${est.missing.join(", ")}. Set a price on the Models tab.` };
  if (est.needs_cap) return { ok: false, status: 400, error: "Set a cost cap for this run" };
  if (est.over_cap && !confirmOverCap)
    return { ok: false, status: 409, error: `The estimate is up to $${money(est.high)}, above the cap of $${money(run.cap_usd ?? 0)}. Start anyway to confirm.` };

  db.prepare("UPDATE eval_runs SET status = 'running', started_at = datetime('now'), stop_reason = '' WHERE id = ?").run(runId);
  const controller = new AbortController();
  controllers.set(runId, controller);
  finished.set(runId, execute(db, vault, run, models, controller).finally(() => { controllers.delete(runId); }));
  return { ok: true };
}

/** Stops a running run now. False when it is not running. */
export function stopRun(db: DB, runId: number): boolean {
  const c = controllers.get(runId);
  if (!c || c.signal.aborted) return false;
  halt(db, runId, c, "stopped", "Stopped by you.");
  return true;
}

/** Ends the run at once; calls in flight are aborted and no new call starts. The first reason wins. */
function halt(db: DB, runId: number, c: AbortController, status: "stopped" | "failed", reason: string) {
  if (c.signal.aborted) return;
  db.prepare("UPDATE eval_runs SET status = ?, stop_reason = ?, ended_at = datetime('now') WHERE id = ?").run(status, reason, runId);
  c.abort();
}

async function execute(db: DB, vault: Vault, run: RunRow, models: RunModel[], c: AbortController): Promise<void> {
  const cases = db.prepare("SELECT id, case_key, input, expected FROM eval_cases WHERE version_id = ? ORDER BY position").all(run.version_id) as CaseRow[];
  const items = models.flatMap((m) => cases.map((cs) => ({ m, cs })));
  const streak = new Map<number, number>();
  let next = 0;

  const worker = async () => {
    while (!c.signal.aborted && next < items.length) {
      const { m, cs } = items[next++];
      const r = await evalCall(db, vault, {
        projectId: run.project_id, providerId: m.provider_id ?? 0, model: m.model, system: run.system_prompt, prompt: cs.input,
        maxTokens: run.max_tokens, signal: c.signal, caseKey: cs.case_key, expected: cs.expected,
      });
      if (!r.ok && r.budget) { halt(db, run.id, c, "stopped", r.error); continue; }
      // A call that was aborted by a stop leaves no result.
      if (!r.ok && c.signal.aborted) continue;
      try {
        db.prepare(`INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status, error, tokens_in, tokens_out, cost_usd, ms, usage_run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(run.id, m.id, cs.id, cs.case_key, r.ok ? r.answer : "", r.ok ? "ok" : "error", r.ok ? "" : r.error.slice(0, 2000), r.tokensIn, r.tokensOut, r.costUsd, r.ms, r.usageRunId);
        db.prepare("UPDATE eval_runs SET cost_usd = cost_usd + ? WHERE id = ?").run(r.costUsd ?? 0, run.id);
      } catch {
        // The run was deleted while a call was in flight.
        continue;
      }
      streak.set(m.id, r.ok ? 0 : (streak.get(m.id) ?? 0) + 1);
      if (!r.ok && (streak.get(m.id) ?? 0) >= MAX_ERRORS_IN_ROW)
        halt(db, run.id, c, "failed", `${m.model} failed ${MAX_ERRORS_IN_ROW} times in a row. Last error: ${r.error.slice(0, 300)}`);
      const spent = (db.prepare("SELECT cost_usd FROM eval_runs WHERE id = ?").get(run.id) as { cost_usd: number } | undefined)?.cost_usd ?? 0;
      if (run.cap_usd !== null && spent >= run.cap_usd)
        halt(db, run.id, c, "stopped", `Cost cap reached ($${money(spent)} of $${money(run.cap_usd)}).`);
    }
  };

  try {
    await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, worker));
  } catch (err) {
    halt(db, run.id, c, "failed", String((err as Error)?.message ?? err));
  }
  if (!c.signal.aborted) db.prepare("UPDATE eval_runs SET status = 'done', ended_at = datetime('now') WHERE id = ?").run(run.id);
}
