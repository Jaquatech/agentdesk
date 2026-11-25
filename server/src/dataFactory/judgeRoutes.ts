import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import type { Vault } from "../crypto.ts";
import { estimateFor, judgeModelOf, startJudge, stopJudge } from "./judgeRunner.ts";

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** Estimate, start, stop and read judge runs of a finished run. */
export function registerJudgeRoutes(app: FastifyInstance, db: DB, vault: Vault, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  const runProject = (id: number) =>
    (db.prepare("SELECT project_id FROM eval_runs WHERE id = ?").get(id) as { project_id: number } | undefined)?.project_id;
  const judgeProject = (id: number) =>
    (db.prepare("SELECT r.project_id FROM eval_judge_runs j JOIN eval_runs r ON r.id = j.run_id WHERE j.id = ?").get(id) as { project_id: number } | undefined)?.project_id;

  const checkedRun = (req: { params: unknown }, reply: FastifyReply): { id: number; projectId: number } | null => {
    const id = Number((req.params as { id: string }).id);
    const projectId = runProject(id);
    if (projectId === undefined) { fail(reply, 404, "No such run"); return null; }
    return projectOn(reply, projectId) ? { id, projectId } : null;
  };
  const checkedJudge = (req: { params: unknown }, reply: FastifyReply): number | null => {
    const id = Number((req.params as { id: string }).id);
    const projectId = judgeProject(id);
    if (projectId === undefined) { fail(reply, 404, "No such judge run"); return null; }
    return projectOn(reply, projectId) ? id : null;
  };

  /** Reads the shared body of estimate and start; a string is the error to send. */
  const readBody = (body: unknown): { evalModelId: number; capUsd: number | null; confirmOverCap: boolean } | string => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.eval_model_id !== "number" || !Number.isInteger(b.eval_model_id)) return "Choose a judge model";
    let capUsd: number | null = null;
    if (b.cap_usd !== undefined && b.cap_usd !== null) {
      if (typeof b.cap_usd !== "number" || !Number.isFinite(b.cap_usd) || b.cap_usd <= 0) return "The cost cap must be a number above 0, or empty for no cap";
      capUsd = b.cap_usd;
    }
    return { evalModelId: b.eval_model_id, capUsd, confirmOverCap: b.confirm_over_cap === true };
  };

  app.post("/api/eval-runs/:id/judge/estimate", async (req, reply) => {
    const r = checkedRun(req, reply);
    if (!r) return;
    const b = readBody(req.body);
    if (typeof b === "string") return fail(reply, 400, b);
    const m = judgeModelOf(db, r.projectId, b.evalModelId);
    if (!m) return fail(reply, 400, "Choose one of the judge models of this project");
    return estimateFor(db, r.id, r.projectId, m, b.capUsd);
  });

  app.post("/api/eval-runs/:id/judge", async (req, reply) => {
    const r = checkedRun(req, reply);
    if (!r) return;
    const b = readBody(req.body);
    if (typeof b === "string") return fail(reply, 400, b);
    const s = startJudge(db, vault, r.id, b);
    if (!s.ok) return fail(reply, s.status, s.error);
    return { id: s.id };
  });

  const COLUMNS = `j.id, j.run_id, j.status, j.stop_reason, j.provider_name, j.model, j.cost_usd, j.cap_usd, j.est_low, j.est_high, j.created_at, j.ended_at,
    (SELECT COUNT(*) FROM eval_judgements WHERE judge_run_id = j.id) AS done_calls,
    (SELECT COUNT(*) FROM eval_judgements WHERE judge_run_id = j.id AND status = 'error') AS error_calls,
    (SELECT COUNT(*) FROM eval_results WHERE run_id = j.run_id AND status = 'ok') AS total_calls`;

  const withSummary = (row: { id: number }) => {
    const summary = db.prepare(`
      SELECT m.id AS run_model_id, m.provider_name, m.model,
        COALESCE(SUM(g.status = 'ok'), 0) AS judged, AVG(CASE WHEN g.status = 'ok' THEN g.score END) AS avg_score,
        AVG(CASE WHEN g.status = 'ok' THEN g.pass END) AS pass_rate, COALESCE(SUM(g.status = 'error'), 0) AS errors
      FROM eval_judgements g JOIN eval_results r ON r.id = g.result_id JOIN eval_run_models m ON m.id = r.run_model_id
      WHERE g.judge_run_id = ? GROUP BY m.id ORDER BY m.id`).all(row.id);
    return { ...row, summary };
  };

  app.get("/api/eval-runs/:id/judge-runs", async (req, reply) => {
    const r = checkedRun(req, reply);
    if (!r) return;
    const rows = db.prepare(`SELECT ${COLUMNS} FROM eval_judge_runs j WHERE j.run_id = ? ORDER BY j.id DESC`).all(r.id) as { id: number }[];
    return rows.map(withSummary);
  });

  app.get("/api/judge-runs/:id", async (req, reply) => {
    const id = checkedJudge(req, reply);
    if (id === null) return;
    return withSummary(db.prepare(`SELECT ${COLUMNS} FROM eval_judge_runs j WHERE j.id = ?`).get(id) as { id: number });
  });

  app.get("/api/judge-runs/:id/results", async (req, reply) => {
    const id = checkedJudge(req, reply);
    if (id === null) return;
    const q = req.query as { model?: string; verdict?: string; offset?: string; limit?: string };
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit) || 50)));
    const modelId = q.model === undefined || q.model === "" ? null : Number(q.model);
    const pass = q.verdict === "pass" ? 1 : q.verdict === "fail" ? 0 : null;
    return db.prepare(`
      SELECT g.result_id, r.case_key, m.model, m.provider_name, c.input, c.expected, r.answer,
        g.score, g.pass, g.reason, g.status, g.error, g.cost_usd
      FROM eval_judgements g
      JOIN eval_results r ON r.id = g.result_id
      JOIN eval_run_models m ON m.id = r.run_model_id
      JOIN eval_cases c ON c.id = r.case_id
      WHERE g.judge_run_id = ? AND (? IS NULL OR r.run_model_id = ?) AND (? IS NULL OR (g.status = 'ok' AND g.pass = ?))
      ORDER BY g.id LIMIT ? OFFSET ?`).all(id, modelId, modelId, pass, pass, limit, offset);
  });

  app.post("/api/judge-runs/:id/stop", async (req, reply) => {
    const id = checkedJudge(req, reply);
    if (id === null) return;
    if (!stopJudge(db, id)) return fail(reply, 409, "This judge run is not running");
    return { ok: true };
  });

  app.delete("/api/judge-runs/:id", async (req, reply) => {
    const id = checkedJudge(req, reply);
    if (id === null) return;
    const j = db.prepare("SELECT status FROM eval_judge_runs WHERE id = ?").get(id) as { status: string };
    if (j.status === "running") return fail(reply, 409, "This judge run is running. Stop it first.");
    db.prepare("DELETE FROM eval_judge_runs WHERE id = ?").run(id);
    return { ok: true };
  });
}
