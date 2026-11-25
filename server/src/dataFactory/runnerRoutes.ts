import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import type { Vault } from "../crypto.ts";
import { startRun, stopRun } from "./runner.ts";

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** Start and stop a planned run, and read what each model answered. */
export function registerRunner(app: FastifyInstance, db: DB, vault: Vault, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  const runProject = (id: number) =>
    (db.prepare("SELECT project_id FROM eval_runs WHERE id = ?").get(id) as { project_id: number } | undefined)?.project_id;

  /** The run id when the run exists and its project has the Data factory on; otherwise the reply is already sent. */
  const checked = (req: { params: unknown }, reply: FastifyReply): number | null => {
    const id = Number((req.params as { id: string }).id);
    const projectId = runProject(id);
    if (projectId === undefined) { fail(reply, 404, "No such run"); return null; }
    return projectOn(reply, projectId) ? id : null;
  };

  app.post("/api/eval-runs/:id/start", async (req, reply) => {
    const id = checked(req, reply);
    if (id === null) return;
    const b = (req.body ?? {}) as { confirm_over_cap?: unknown };
    const r = startRun(db, vault, id, b.confirm_over_cap === true);
    if (!r.ok) return fail(reply, r.status, r.error);
    return { ok: true };
  });

  app.post("/api/eval-runs/:id/stop", async (req, reply) => {
    const id = checked(req, reply);
    if (id === null) return;
    if (!stopRun(db, id)) return fail(reply, 409, "This run is not running");
    return { ok: true };
  });

  app.get("/api/eval-runs/:id/results", async (req, reply) => {
    const id = checked(req, reply);
    if (id === null) return;
    const q = req.query as { model?: string; offset?: string; limit?: string };
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit) || 50)));
    const modelId = q.model === undefined || q.model === "" ? null : Number(q.model);
    return db.prepare(`
      SELECT r.id, r.run_model_id, r.case_id, r.case_key, c.input, c.expected, m.model, m.provider_name,
        r.answer, r.status, r.error, r.tokens_in, r.tokens_out, r.cost_usd, r.ms
      FROM eval_results r
      JOIN eval_run_models m ON m.id = r.run_model_id
      JOIN eval_cases c ON c.id = r.case_id
      WHERE r.run_id = ? AND (? IS NULL OR r.run_model_id = ?)
      ORDER BY r.run_model_id, c.position LIMIT ? OFFSET ?`).all(id, modelId, modelId, limit, offset);
  });
}
