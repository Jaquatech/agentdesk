import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import readXlsxFile from "read-excel-file/node";
import { buildApp } from "../src/index.ts";
import { buildReport } from "../src/dataFactory/report.ts";
import { reportXlsx } from "../src/dataFactory/reportXlsx.ts";

async function setup(answer: string) {
  const data = mkdtempSync(join(tmpdir(), "ad-xl-"));
  const repo = mkdtempSync(join(tmpdir(), "ad-xl-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# demo\n");
  const ctx = await buildApp({ dataDir: data });
  const res = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  const headers = { cookie, host: "localhost" };
  const project = (await ctx.app.inject({ method: "POST", url: "/api/projects", headers, payload: { name: "df", source: "local", path: repo, data_factory: 1 } })).json().id;
  const ds = (await ctx.app.inject({ method: "POST", url: `/api/projects/${project}/datasets`, headers,
    payload: { name: "set", format: "jsonl", text: JSON.stringify({ input: "q1", expected: "a1" }) } })).json();
  const c = ctx.db.prepare("SELECT id, case_key FROM eval_cases WHERE version_id = ?").get(ds.version.id) as { id: number; case_key: string };
  const run = Number(ctx.db.prepare("INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status) VALUES (?, ?, 'r', 'p', 100, 'done')")
    .run(project, ds.version.id).lastInsertRowid);
  const m = Number(ctx.db.prepare("INSERT INTO eval_run_models (run_id, provider_name, model) VALUES (?, 'P', 'm')").run(run).lastInsertRowid);
  const res1 = Number(ctx.db.prepare("INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status, error, tokens_in, tokens_out, cost_usd, ms) VALUES (?, ?, ?, ?, ?, 'ok', '', 1, 1, 0.1, 5)")
    .run(run, m, c.id, c.case_key, answer).lastInsertRowid);
  const j = Number(ctx.db.prepare("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'P', 'jm', 'guide', 'done')").run(run).lastInsertRowid);
  ctx.db.prepare("INSERT INTO eval_judgements (judge_run_id, result_id, score, pass, reason, status) VALUES (?, ?, 4, 1, 'ok', 'ok')").run(j, res1);
  return { ctx, headers, run, report: buildReport(ctx.db, run, j) };
}

describe("report xlsx", () => {
  it("has the three sheets, keeps =1+1 as text and the score as a number", async () => {
    const { ctx, report } = await setup("=1+1");
    const sheets = await readXlsxFile(await reportXlsx(report));
    expect(sheets.map((s) => s.sheet)).toEqual(["Summary", "Models", "Cases"]);
    const cases = sheets[2].data;
    expect(cases[1][cases[0].indexOf("answer")]).toBe("=1+1");
    expect(cases[1][cases[0].indexOf("score")]).toBe(4);
    await ctx.app.close();
  });

  it("cleans control characters and cuts long text", async () => {
    const { ctx, report } = await setup("\u0001" + "x".repeat(40000));
    const cases = (await readXlsxFile(await reportXlsx(report)))[2].data;
    const answer = String(cases[1][cases[0].indexOf("answer")]);
    expect(answer.length).toBeLessThanOrEqual(32767);
    expect(answer.endsWith("… (cut)")).toBe(true);
    expect(answer.includes("\u0001")).toBe(false);
    await ctx.app.close();
  });

  it("is served by the route", async () => {
    const { ctx, headers, run } = await setup("a");
    const r = await ctx.app.inject({ method: "GET", url: `/api/eval-runs/${run}/report.xlsx`, headers });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers["content-disposition"]).toContain(`run-${run}-report.xlsx`);
    expect(r.rawPayload.subarray(0, 2).toString()).toBe("PK");
    await ctx.app.close();
  });
});
