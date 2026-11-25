import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import { estimateRun, type RunEstimate } from "./estimate.ts";
import { priceStatus } from "./modelFamily.ts";

const MAX_NAME = 120;
const MAX_PROMPT = 8000;
const MAX_MODELS = 20;

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

type Plan = {
  versionId: number; name: string; systemPrompt: string; maxTokens: number; capUsd: number | null;
  models: { id: number; provider_id: number; provider_name: string; model: string }[];
};
type PlanModel = Plan["models"][number];

export function estimateFor(db: DB, versionId: number, p: { systemPrompt: string; maxTokens: number; capUsd: number | null }, models: { provider_id: number | null; provider_name: string; model: string }[]): RunEstimate {
  const cases = db.prepare("SELECT input, expected FROM eval_cases WHERE version_id = ? ORDER BY position").all(versionId) as { input: string; expected: string | null }[];
  const providers = new Map<number, { kind: string; secret_id: number | null }>();
  return estimateRun({
    cases, systemPrompt: p.systemPrompt, maxTokens: p.maxTokens, capUsd: p.capUsd,
    models: models.map((m) => {
      let prov = m.provider_id === null ? undefined : providers.get(m.provider_id);
      if (!prov && m.provider_id !== null) {
        prov = db.prepare("SELECT kind, secret_id FROM providers WHERE id = ?").get(m.provider_id) as { kind: string; secret_id: number | null } | undefined;
        if (prov) providers.set(m.provider_id, prov);
      }
      // A provider that is gone has no known kind: its model is priced from the table or missing.
      const s = priceStatus(db, prov ?? { kind: "", secret_id: null }, m.model);
      return { provider_name: m.provider_name, model: m.model, price: s.price, free: s.status === "free" };
    }),
  });
}

/** Plans of runs: a dataset version, the models to test, a prompt and caps, with a cost estimate. Nothing is sent to a model. */
export function registerRunPlans(app: FastifyInstance, db: DB, projectOn: (reply: FastifyReply, projectId: number) => boolean) {

  /** Reads and checks the shared body of estimate and create; the reply is sent when it returns a string. */
  const readPlan = (projectId: number, body: unknown): Plan | string => {
    const b = (body ?? {}) as Record<string, unknown>;
    const versionId = Number(b.version_id);
    const v = db.prepare(`SELECT v.case_count FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.id = ? AND d.project_id = ?`).get(versionId, projectId) as { case_count: number } | undefined;
    if (!Number.isInteger(versionId) || !v) return "Choose a dataset version of this project";
    const cases = db.prepare("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?").get(versionId) as { n: number };
    if (cases.n === 0) return "This dataset version has no cases";

    const ids = b.model_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_MODELS || !ids.every((x) => Number.isInteger(x)) || new Set(ids).size !== ids.length)
      return `Choose 1 to ${MAX_MODELS} different models`;
    const models: PlanModel[] = [];
    for (const id of ids as number[]) {
      const m = db.prepare(`
        SELECT m.id, m.provider_id, p.name AS provider_name, m.model FROM eval_models m JOIN providers p ON p.id = m.provider_id
        WHERE m.id = ? AND m.project_id = ? AND m.for_test = 1`).get(id, projectId) as PlanModel | undefined;
      if (!m) return "Every model must be in this project's list and marked for testing";
      models.push(m);
    }

    let maxTokens = 512;
    if (b.max_tokens !== undefined && b.max_tokens !== null) {
      if (typeof b.max_tokens !== "number" || !Number.isInteger(b.max_tokens) || b.max_tokens < 16 || b.max_tokens > 8192) return "max_tokens must be a whole number from 16 to 8192";
      maxTokens = b.max_tokens;
    }
    let systemPrompt = "";
    if (b.system_prompt !== undefined && b.system_prompt !== null) {
      if (typeof b.system_prompt !== "string" || b.system_prompt.length > MAX_PROMPT) return `The system prompt can be up to ${MAX_PROMPT} characters`;
      systemPrompt = b.system_prompt;
    }
    let name = "";
    if (b.name !== undefined && b.name !== null) {
      if (typeof b.name !== "string" || b.name.trim().length > MAX_NAME) return `The name can be up to ${MAX_NAME} characters`;
      name = b.name.trim();
    }
    let capUsd: number | null = null;
    if (b.cap_usd !== undefined && b.cap_usd !== null) {
      if (typeof b.cap_usd !== "number" || !Number.isFinite(b.cap_usd) || b.cap_usd <= 0) return "The cost cap must be a number above 0, or empty for no cap";
      capUsd = b.cap_usd;
    }
    return { versionId, name, systemPrompt, maxTokens, capUsd, models };
  };

  const planned = (req: { params: unknown; body: unknown }, reply: FastifyReply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return null;
    const plan = readPlan(projectId, req.body);
    if (typeof plan === "string") { fail(reply, 400, plan); return null; }
    return { projectId, plan, estimate: estimateFor(db, plan.versionId, plan, plan.models) };
  };

  app.post("/api/projects/:id/runs/estimate", async (req, reply) => {
    const r = planned(req, reply);
    if (!r) return;
    return r.estimate;
  });

  app.post("/api/projects/:id/runs", async (req, reply) => {
    const r = planned(req, reply);
    if (!r) return;
    const { plan, estimate } = r;
    db.exec("BEGIN");
    try {
      const run = db.prepare(`INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, cap_usd, est_low, est_high)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(r.projectId, plan.versionId, plan.name, plan.systemPrompt, plan.maxTokens, plan.capUsd, estimate.low, estimate.high);
      const id = Number(run.lastInsertRowid);
      const ins = db.prepare("INSERT INTO eval_run_models (run_id, provider_id, provider_name, model) VALUES (?, ?, ?, ?)");
      for (const m of plan.models) ins.run(id, m.provider_id, m.provider_name, m.model);
      db.exec("COMMIT");
      return { id, estimate };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });

  app.get("/api/projects/:id/runs", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    return db.prepare(`
      SELECT r.id, r.name, r.status, r.stop_reason, d.id AS dataset_id, d.name AS dataset_name, v.version, v.case_count,
        (SELECT COUNT(*) FROM eval_run_models WHERE run_id = r.id) AS model_count,
        r.est_low, r.est_high, r.cost_usd, r.created_at, r.started_at, r.ended_at
      FROM eval_runs r JOIN eval_dataset_versions v ON v.id = r.version_id JOIN eval_datasets d ON d.id = v.dataset_id
      WHERE r.project_id = ? ORDER BY r.id DESC LIMIT 100`).all(projectId);
  });

  const runProject = (id: number) =>
    (db.prepare("SELECT project_id FROM eval_runs WHERE id = ?").get(id) as { project_id: number } | undefined)?.project_id;

  app.get("/api/eval-runs/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = runProject(id);
    if (projectId === undefined) return fail(reply, 404, "No such run");
    if (!projectOn(reply, projectId)) return;
    const run = db.prepare(`
      SELECT r.*, d.id AS dataset_id, d.name AS dataset_name, v.version, v.case_count
      FROM eval_runs r JOIN eval_dataset_versions v ON v.id = r.version_id JOIN eval_datasets d ON d.id = v.dataset_id
      WHERE r.id = ?`).get(id) as { version_id: number; system_prompt: string; max_tokens: number; cap_usd: number | null; case_count: number; cost_usd: number };
    const models = db.prepare("SELECT id, provider_id, provider_name, model FROM eval_run_models WHERE run_id = ? ORDER BY id").all(id) as
      { id: number; provider_id: number | null; provider_name: string; model: string }[];
    const estimate = estimateFor(db, run.version_id, { systemPrompt: run.system_prompt, maxTokens: run.max_tokens, capUsd: run.cap_usd }, models);
    const p = db.prepare(`SELECT COUNT(*) AS done_calls, COALESCE(SUM(status = 'error'), 0) AS error_calls FROM eval_results WHERE run_id = ?`).get(id) as { done_calls: number; error_calls: number };
    const progress = { total_calls: run.case_count * models.length, ...p, cost_usd: run.cost_usd };
    return { ...run, models, estimate, progress };
  });

  app.delete("/api/eval-runs/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = runProject(id);
    if (projectId === undefined) return fail(reply, 404, "No such run");
    if (!projectOn(reply, projectId)) return;
    const r = db.prepare("SELECT status FROM eval_runs WHERE id = ?").get(id) as { status: string };
    if (r.status === "running") return fail(reply, 409, "This run is running. Stop it first.");
    db.prepare("DELETE FROM eval_runs WHERE id = ?").run(id);
    return { ok: true };
  });
}
