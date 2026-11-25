import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import { DEFAULT_RUBRIC, FORMAT_LINE, judgeOptions } from "./judge.ts";
import { modelFamily, priceStatus } from "./modelFamily.ts";

const MAX_RUBRIC = 4000;

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** The judge's rubric per project, and the judge models to offer for a run. Nothing is sent to a model. */
export function registerJudgeConfig(app: FastifyInstance, db: DB, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  const body = (projectId: number) => {
    const row = db.prepare("SELECT rubric FROM eval_judge_config WHERE project_id = ?").get(projectId) as { rubric: string } | undefined;
    const stored = row?.rubric ?? "";
    const isDefault = stored.trim() === "";
    return { rubric: isDefault ? DEFAULT_RUBRIC : stored, is_default: isDefault, default_rubric: DEFAULT_RUBRIC, format_line: FORMAT_LINE };
  };

  app.get("/api/projects/:id/judge", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    return body(projectId);
  });

  app.put("/api/projects/:id/judge", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    const b = (req.body ?? {}) as { rubric?: unknown };
    if (typeof b.rubric !== "string") return fail(reply, 400, "rubric must be text");
    if (b.rubric.length > MAX_RUBRIC) return fail(reply, 400, `The rubric can be up to ${MAX_RUBRIC} characters`);
    const text = b.rubric.trim() === "" ? "" : b.rubric;
    db.prepare("INSERT INTO eval_judge_config (project_id, rubric) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET rubric = excluded.rubric").run(projectId, text);
    return body(projectId);
  });

  app.get("/api/eval-runs/:id/judge-options", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const run = db.prepare("SELECT project_id FROM eval_runs WHERE id = ?").get(id) as { project_id: number } | undefined;
    if (!run) return fail(reply, 404, "No such run");
    if (!projectOn(reply, run.project_id)) return;
    const rows = db.prepare(`
      SELECT m.id, m.provider_id, p.name AS provider_name, p.kind AS provider_kind, p.secret_id, m.model
      FROM eval_models m JOIN providers p ON p.id = m.provider_id
      WHERE m.project_id = ? AND m.for_judge = 1 ORDER BY m.model, p.name`).all(run.project_id) as
      { id: number; provider_id: number; provider_name: string; provider_kind: string; secret_id: number | null; model: string }[];
    const tested = (db.prepare("SELECT model FROM eval_run_models WHERE run_id = ?").all(id) as { model: string }[]).map((m) => modelFamily(m.model));
    const models = rows.map(({ provider_kind, secret_id, ...r }) => ({
      ...r, family: modelFamily(r.model), price_status: priceStatus(db, { kind: provider_kind, secret_id }, r.model).status,
    }));
    return judgeOptions(models, tested);
  });
}
