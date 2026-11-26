import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import {
  approveVersion, checkVersion, cleanTermList, deleteVersion, readOptions, readTerms, versionRow, writeTerms,
} from "./pipeline.ts";

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** Own names and terms, the sensitive-data check, approval and deletion of dataset versions. Nothing is sent to a model. */
export function registerPipelineRoutes(app: FastifyInstance, db: DB, dataDir: string, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  app.get("/api/projects/:id/sensitive-terms", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    return readTerms(db, projectId);
  });

  app.put("/api/projects/:id/sensitive-terms", async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    if (!projectOn(reply, projectId)) return;
    const b = (req.body ?? {}) as { people?: unknown; terms?: unknown };
    const people = cleanTermList(b.people, "People");
    if (typeof people === "string") return fail(reply, 400, people);
    const terms = cleanTermList(b.terms, "Terms");
    if (typeof terms === "string") return fail(reply, 400, terms);
    writeTerms(db, projectId, { people, terms });
    return { people, terms };
  });

  /** The version when it exists and its project has the Data factory on; otherwise the reply is already sent. */
  const checked = (req: { params: unknown }, reply: FastifyReply) => {
    const v = versionRow(db, Number((req.params as { id: string }).id));
    if (!v) { fail(reply, 404, "No such version"); return null; }
    return projectOn(reply, v.project_id) ? v : null;
  };

  app.post("/api/dataset-versions/:id/check", async (req, reply) => {
    const v = checked(req, reply);
    if (!v) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const options = readOptions(b);
    if (typeof options === "string") return fail(reply, 400, options);
    const offset = b.offset === undefined ? 0 : b.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) return fail(reply, 400, "offset must be a whole number, 0 or more");
    return checkVersion(db, v, options, offset);
  });

  app.post("/api/dataset-versions/:id/approve", async (req, reply) => {
    const v = checked(req, reply);
    if (!v) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const options = readOptions(b);
    if (typeof options === "string") return fail(reply, 400, options);
    const r = approveVersion(db, dataDir, v, { ...options, deleteOriginal: b.delete_original !== false });
    if (!r.ok) return fail(reply, r.status, r.error);
    return { version: r.version, original_deleted: r.original_deleted, kept_reason: r.kept_reason };
  });

  app.delete("/api/dataset-versions/:id", async (req, reply) => {
    const v = checked(req, reply);
    if (!v) return;
    const r = deleteVersion(db, dataDir, v);
    if (!r.ok) return fail(reply, r.status, r.error);
    return { ok: true };
  });
}
