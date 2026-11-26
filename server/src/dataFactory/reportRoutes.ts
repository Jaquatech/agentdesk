import type { FastifyInstance, FastifyReply } from "fastify";
import type { DB } from "../db.ts";
import { buildReport, defaultJudgeRun, judgeRunsOf } from "./report.ts";
import { reportCsv } from "./reportCsv.ts";
import { reportMarkdown } from "./reportMarkdown.ts";

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** The report of one finished run, as data, Markdown, CSV and JSON. */
export function registerReportRoutes(app: FastifyInstance, db: DB, projectOn: (reply: FastifyReply, projectId: number) => boolean) {
  /** Checks the run and the judge choice; null when the reply was already sent. */
  const checked = (req: { params: unknown; query: unknown }, reply: FastifyReply) => {
    const id = Number((req.params as { id: string }).id);
    const run = db.prepare("SELECT project_id, status FROM eval_runs WHERE id = ?").get(id) as { project_id: number; status: string } | undefined;
    if (!run) { fail(reply, 404, "No such run"); return null; }
    if (!projectOn(reply, run.project_id)) return null;
    if (run.status === "planned" || run.status === "running") { fail(reply, 409, "This run has not finished yet"); return null; }
    const q = req.query as { judge?: string; all?: string };
    let judgeId: number | null;
    if (q.judge === undefined || q.judge === "") judgeId = defaultJudgeRun(db, id);
    else {
      judgeId = Number(q.judge);
      if (!Number.isInteger(judgeId) || !db.prepare("SELECT 1 FROM eval_judge_runs WHERE id = ? AND run_id = ?").get(judgeId, id)) {
        fail(reply, 404, "No such judge run");
        return null;
      }
    }
    return { id, report: buildReport(db, id, judgeId), all: q.all === "1" };
  };
  const attach = (reply: FastifyReply, id: number, ext: string, type: string, body: string) =>
    reply.header("content-type", `${type}; charset=utf-8`).header("content-disposition", `attachment; filename="run-${id}-report.${ext}"`).send(body);

  app.get("/api/eval-runs/:id/report", async (req, reply) => {
    const c = checked(req, reply);
    if (!c) return;
    return { report: c.report, markdown: reportMarkdown(c.report, { all: c.all }), judge_runs: judgeRunsOf(db, c.id) };
  });
  app.get("/api/eval-runs/:id/report.md", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c.id, "md", "text/markdown", reportMarkdown(c.report, { all: c.all }));
  });
  app.get("/api/eval-runs/:id/report.csv", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c.id, "csv", "text/csv", reportCsv(c.report));
  });
  app.get("/api/eval-runs/:id/report.json", async (req, reply) => {
    const c = checked(req, reply);
    if (c) return attach(reply, c.id, "json", "application/json", JSON.stringify(c.report, null, 2));
  });
}
