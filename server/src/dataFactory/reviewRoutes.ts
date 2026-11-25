import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import { itemOf, reviewList, reviewSummary } from "./review.ts";

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const MAX_NOTE = 500;

/** Blind review: votes on the answers of a run, and how they compare with the judge. */
export function registerReviewRoutes(app: FastifyInstance, db: DB, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  const runProject = (id: number) =>
    (db.prepare("SELECT project_id FROM eval_runs WHERE id = ?").get(id) as { project_id: number } | undefined)?.project_id;
  const resultInfo = (id: number) =>
    db.prepare("SELECT r.status, e.project_id FROM eval_results r JOIN eval_runs e ON e.id = r.run_id WHERE r.id = ?").get(id) as { status: string; project_id: number } | undefined;

  const checkedRun = (req: { params: unknown }, reply: FastifyReply): number | null => {
    const id = Number((req.params as { id: string }).id);
    const projectId = runProject(id);
    if (projectId === undefined) { fail(reply, 404, "No such run"); return null; }
    return projectOn(reply, projectId) ? id : null;
  };
  const checkedResult = (req: { params: unknown }, reply: FastifyReply): { id: number; status: string } | null => {
    const id = Number((req.params as { id: string }).id);
    const r = resultInfo(id);
    if (!r) { fail(reply, 404, "No such answer"); return null; }
    return projectOn(reply, r.project_id) ? { id, status: r.status } : null;
  };

  app.get("/api/eval-runs/:id/review", async (req, reply) => {
    const id = checkedRun(req, reply);
    if (id === null) return;
    const q = req.query as { model?: string; unvoted?: string; offset?: string; limit?: string };
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(q.limit) || 20)));
    const modelId = q.model === undefined || q.model === "" || !Number.isFinite(Number(q.model)) ? null : Number(q.model);
    return reviewList(db, id, modelId, q.unvoted === "1", offset, limit);
  });

  app.put("/api/eval-results/:id/vote", async (req, reply) => {
    const r = checkedResult(req, reply);
    if (!r) return;
    const b = (req.body ?? {}) as { verdict?: unknown; note?: unknown };
    if (b.verdict !== "good" && b.verdict !== "bad") return fail(reply, 400, "The verdict must be good or bad");
    if (b.note !== undefined && typeof b.note !== "string") return fail(reply, 400, "The note must be text");
    const note = b.note ?? "";
    if (note.length > MAX_NOTE) return fail(reply, 400, `The note can have at most ${MAX_NOTE} characters`);
    if (r.status !== "ok") return fail(reply, 409, "Only answers that were received can be voted on");
    db.prepare(`INSERT INTO eval_votes (result_id, verdict, note) VALUES (?, ?, ?)
      ON CONFLICT(result_id) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, updated_at = datetime('now')`).run(r.id, b.verdict, note);
    return itemOf(db, r.id);
  });

  app.delete("/api/eval-results/:id/vote", async (req, reply) => {
    const r = checkedResult(req, reply);
    if (!r) return;
    db.prepare("DELETE FROM eval_votes WHERE result_id = ?").run(r.id);
    return { ok: true };
  });

  app.get("/api/eval-runs/:id/review-summary", async (req, reply) => {
    const id = checkedRun(req, reply);
    if (id === null) return;
    return reviewSummary(db, id);
  });
}
