import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import { compareReports } from "./compare.ts";
import { compareCsv, compareMarkdown, compareXlsx } from "./compareExport.ts";
import { buildReport, defaultJudgeRun, judgeRunsOf } from "./report.ts";

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** Two finished runs of one project compared, as data, Markdown, CSV, JSON and Excel. */
export function registerCompareRoutes(app: FastifyInstance, db: DB, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  const runOf = (raw: string | undefined) => {
    const id = Number(raw);
    if (!Number.isInteger(id)) return null;
    const run = db.prepare("SELECT project_id, status FROM eval_runs WHERE id = ?").get(id) as { project_id: number; status: string } | undefined;
    return run ? { id, ...run } : null;
  };
  /** The judge run for one side: undefined when the id is not a judge run of that run. */
  const judgeFor = (runId: number, raw: string | undefined): number | null | undefined => {
    if (raw === undefined || raw === "") return defaultJudgeRun(db, runId);
    const id = Number(raw);
    if (!Number.isInteger(id) || !db.prepare("SELECT 1 FROM eval_judge_runs WHERE id = ? AND run_id = ?").get(id, runId)) return undefined;
    return id;
  };

  /** Checks the query; null when the reply was already sent. */
  const checked = (req: { query: unknown }, reply: FastifyReply) => {
    const q = req.query as { a?: string; b?: string; judge_a?: string; judge_b?: string };
    const a = runOf(q.a);
    const b = runOf(q.b);
    if (!a || !b) { fail(reply, 404, "No such run"); return null; }
    if (a.id === b.id) { fail(reply, 400, "Choose two different runs"); return null; }
    if (a.project_id !== b.project_id) { fail(reply, 400, "Choose two runs of the same project"); return null; }
    if (!projectOn(reply, a.project_id)) return null;
    if ([a, b].some((r) => r.status === "planned" || r.status === "running")) { fail(reply, 409, "This run has not finished yet"); return null; }
    const ja = judgeFor(a.id, q.judge_a);
    const jb = judgeFor(b.id, q.judge_b);
    if (ja === undefined || jb === undefined) { fail(reply, 404, "No such judge run"); return null; }
    return { a: a.id, b: b.id, compare: compareReports(buildReport(db, a.id, ja), buildReport(db, b.id, jb)) };
  };
  const attach = (reply: FastifyReply, c: { a: number; b: number }, ext: string, type: string, body: string | Buffer) =>
    reply.header("content-type", type.startsWith("text/") || type === "application/json" ? `${type}; charset=utf-8` : type)
      .header("content-disposition", `attachment; filename="compare-${c.a}-${c.b}.${ext}"`).send(body);

  app.get("/api/eval-compare", async (req, reply) => {
    const c = checked(req, reply);
    if (!c) return;
    return { compare: c.compare, markdown: compareMarkdown(c.compare), judge_runs_a: judgeRunsOf(db, c.a), judge_runs_b: judgeRunsOf(db, c.b) };
  });
  app.get("/api/eval-compare.md", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c, "md", "text/markdown", compareMarkdown(c.compare));
  });
  app.get("/api/eval-compare.csv", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c, "csv", "text/csv", compareCsv(c.compare));
  });
  app.get("/api/eval-compare.json", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c, "json", "application/json", JSON.stringify(c.compare, null, 2));
  });
  app.get("/api/eval-compare.xlsx", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await compareXlsx(c.compare));
  });
}
