import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import type { DatasetFormat } from "./datasetParser.ts";
import { DatasetInUseError, deleteDataset, importDataset } from "./datasets.ts";
import { modelFamily, priceStatus } from "./modelFamily.ts";
import { registerRunPlans } from "./runPlans.ts";

const FORMATS = new Set(["jsonl", "json", "csv"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 120;

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** Datasets of the Data factory. Every route refuses a project that has the Data factory off. */
export function registerDataFactory(app: FastifyInstance, db: DB, dataDir: string) {
  /** True when the project exists and has the Data factory on; otherwise the reply is already sent. */
  const projectOn = (reply: FastifyReply, projectId: number): boolean => {
    const p = db.prepare("SELECT data_factory FROM projects WHERE id = ?").get(projectId) as { data_factory: number } | undefined;
    if (!p) { fail(reply, 404, "No such project"); return false; }
    if (p.data_factory !== 1) { fail(reply, 409, "The Data factory is off for this project"); return false; }
    return true;
  };

  registerRunPlans(app, db, projectOn);

  const datasetProject = (id: number) =>
    (db.prepare("SELECT project_id FROM eval_datasets WHERE id = ?").get(id) as { project_id: number } | undefined)?.project_id;

  app.get("/api/projects/:id/datasets", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    return db.prepare(`
      SELECT d.id, d.name, d.created_at, v.id AS version_id, v.version, v.format, v.case_count, v.note, v.created_at AS version_created_at
      FROM eval_datasets d
      JOIN eval_dataset_versions v ON v.dataset_id = d.id
        AND v.version = (SELECT MAX(version) FROM eval_dataset_versions WHERE dataset_id = d.id)
      WHERE d.project_id = ? ORDER BY d.name`).all(projectId);
  });

  app.get("/api/datasets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = datasetProject(id);
    if (projectId === undefined) return fail(reply, 404, "No such dataset");
    if (!projectOn(reply, projectId)) return;
    const dataset = db.prepare("SELECT id, project_id, name, created_at FROM eval_datasets WHERE id = ?").get(id);
    const versions = db.prepare("SELECT * FROM eval_dataset_versions WHERE dataset_id = ? ORDER BY version DESC").all(id);
    return { ...(dataset as object), versions };
  });

  app.get("/api/dataset-versions/:id/cases", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { offset?: string; limit?: string };
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit) || 50)));
    const v = db.prepare(`SELECT d.project_id FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.id = ?`).get(id) as { project_id: number } | undefined;
    if (!v) return fail(reply, 404, "No such version");
    if (!projectOn(reply, v.project_id)) return;
    const rows = db.prepare("SELECT case_key, input, expected, tags, meta, position FROM eval_cases WHERE version_id = ? ORDER BY position LIMIT ? OFFSET ?").all(id, limit, offset) as
      { case_key: string; input: string; expected: string | null; tags: string; meta: string; position: number }[];
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags), meta: JSON.parse(r.meta) }));
  });

  app.post("/api/projects/:id/datasets", { bodyLimit: MAX_UPLOAD_BYTES + 1024 * 1024 }, async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    const b = (req.body ?? {}) as { name?: unknown; format?: unknown; text?: unknown; note?: unknown; source_name?: unknown };
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > MAX_NAME) return fail(reply, 400, `Give the dataset a name of up to ${MAX_NAME} characters`);
    if (typeof b.format !== "string" || !FORMATS.has(b.format)) return fail(reply, 400, "format must be jsonl, json or csv");
    if (typeof b.text !== "string" || b.text.trim() === "") return fail(reply, 400, "The file is empty");
    if (Buffer.byteLength(b.text) > MAX_UPLOAD_BYTES) return fail(reply, 400, "The file is larger than 10 MB");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    // Only the last path segment of the picked file's name is kept.
    const sourceName = typeof b.source_name === "string" ? (b.source_name.split(/[\\/]/).pop() ?? "").trim().slice(0, 255) : "";
    const result = importDataset(db, dataDir, { projectId, name, format: b.format as DatasetFormat, text: b.text, note, sourceName });
    if (!result.ok) return reply.code(400).send({ error: "The file has problems", problems: result.problems, warnings: result.warnings });
    return { dataset_id: result.datasetId, version: result.version, unchanged: result.unchanged, warnings: result.warnings };
  });

  app.delete("/api/datasets/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = datasetProject(id);
    if (projectId === undefined) return fail(reply, 404, "No such dataset");
    if (!projectOn(reply, projectId)) return;
    try {
      deleteDataset(db, dataDir, id);
    } catch (err) {
      if (err instanceof DatasetInUseError) return fail(reply, 409, err.message);
      throw err;
    }
    return { ok: true };
  });

  // Models the project tests and judges with. Prices come from the global model_prices table.
  const roles = (b: { for_test?: unknown; for_judge?: unknown }, defTest: boolean, defJudge: boolean) => {
    const forTest = b.for_test === undefined ? defTest : b.for_test === true || b.for_test === 1;
    const forJudge = b.for_judge === undefined ? defJudge : b.for_judge === true || b.for_judge === 1;
    return { forTest, forJudge };
  };
  const cutNote = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 500) : "");

  app.get("/api/projects/:id/models", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    const rows = db.prepare(`
      SELECT m.id, m.provider_id, p.name AS provider_name, p.kind AS provider_kind, p.secret_id, m.model, m.for_test, m.for_judge, m.note
      FROM eval_models m JOIN providers p ON p.id = m.provider_id
      WHERE m.project_id = ? ORDER BY m.model, p.name`).all(projectId) as
      { id: number; provider_id: number; provider_name: string; provider_kind: string; secret_id: number | null; model: string; for_test: number; for_judge: number; note: string }[];
    return rows.map(({ secret_id, ...r }) => {
      const { status, price } = priceStatus(db, { kind: r.provider_kind, secret_id }, r.model);
      return {
        ...r, family: modelFamily(r.model), price_status: status,
        price_in: price?.price_in ?? null, price_out: price?.price_out ?? null,
        cache_read: price?.cache_read ?? null, cache_write: price?.cache_write ?? null,
      };
    });
  });

  app.post("/api/projects/:id/models", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    const b = (req.body ?? {}) as { provider_id?: unknown; model?: unknown; for_test?: unknown; for_judge?: unknown; note?: unknown };
    const model = typeof b.model === "string" ? b.model.trim() : "";
    if (!model || model.length > 200) return fail(reply, 400, "Give the model id, 1 to 200 characters");
    const provider = db.prepare("SELECT id, kind FROM providers WHERE id = ?").get(Number(b.provider_id)) as { id: number; kind: string } | undefined;
    if (!provider) return fail(reply, 400, "No such provider");
    if (provider.kind === "claude-cli") return fail(reply, 400, "The Claude CLI cannot be tested as a model here. Use an API provider.");
    const { forTest, forJudge } = roles(b, true, false);
    if (!forTest && !forJudge) return fail(reply, 400, "Choose at least one role: test or judge");
    if (db.prepare("SELECT id FROM eval_models WHERE project_id = ? AND provider_id = ? AND model = ?").get(projectId, provider.id, model))
      return fail(reply, 409, "This model is already in the list for that provider");
    const r = db.prepare("INSERT INTO eval_models (project_id, provider_id, model, for_test, for_judge, note) VALUES (?, ?, ?, ?, ?, ?)")
      .run(projectId, provider.id, model, forTest ? 1 : 0, forJudge ? 1 : 0, cutNote(b.note));
    return { id: Number(r.lastInsertRowid) };
  });

  const modelProject = (id: number) =>
    (db.prepare("SELECT project_id FROM eval_models WHERE id = ?").get(id) as { project_id: number } | undefined)?.project_id;

  app.put("/api/eval-models/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = modelProject(id);
    if (projectId === undefined) return fail(reply, 404, "No such model");
    if (!projectOn(reply, projectId)) return;
    const b = (req.body ?? {}) as { for_test?: unknown; for_judge?: unknown; note?: unknown };
    const { forTest, forJudge } = roles(b, false, false);
    if (!forTest && !forJudge) return fail(reply, 400, "Choose at least one role: test or judge");
    db.prepare("UPDATE eval_models SET for_test = ?, for_judge = ?, note = ? WHERE id = ?").run(forTest ? 1 : 0, forJudge ? 1 : 0, cutNote(b.note), id);
    return { ok: true };
  });

  app.delete("/api/eval-models/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const projectId = modelProject(id);
    if (projectId === undefined) return fail(reply, 404, "No such model");
    if (!projectOn(reply, projectId)) return;
    db.prepare("DELETE FROM eval_models WHERE id = ?").run(id);
    return { ok: true };
  });
}
