import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";

describe("run report", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let projectId: number, offId: number, runId: number, offRunId: number, planned: number, otherRun: number, otherJudge: number;
  let oldJudge: number, newJudge: number, errJudge: number;
  let modelA: number, modelB: number;
  let results: number[]; // model A's four results, then model B's ok and error result

  const sql = (q: string, ...p: any[]) => ctx.db.prepare(q).run(...p);
  const get = (url: string) => ctx.app.inject({ method: "GET", url, headers: { cookie, host: "localhost" } });
  const json = async (url: string) => (await get(url)).json();

  beforeEach(async () => {
    const data = mkdtempSync(join(tmpdir(), "ad-rp-"));
    const repo = mkdtempSync(join(tmpdir(), "ad-rp-repo-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "# demo\n");
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const post = async (url: string, payload: unknown) =>
      (await ctx.app.inject({ method: "POST", url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
    projectId = (await post("/api/projects", { name: "df", source: "local", path: repo, data_factory: 1 })).id;
    offId = (await post("/api/projects", { name: "off", source: "local", path: repo })).id;
    const d = await post(`/api/projects/${projectId}/datasets`, {
      name: "set", format: "jsonl", text: [1, 2, 3, 4].map((n) => JSON.stringify({ input: `q${n}`, expected: `a${n}` })).join("\n"),
    });
    const versionId = d.version.id;
    const cases = ctx.db.prepare("SELECT id, case_key FROM eval_cases WHERE version_id = ? ORDER BY position").all(versionId) as { id: number; case_key: string }[];
    const mkRun = (project: number, status = "done") => Number(sql(
      "INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status) VALUES (?, ?, 'r', 'be brief', 100, ?)", project, versionId, status).lastInsertRowid);
    runId = mkRun(projectId);
    offRunId = mkRun(offId);
    planned = mkRun(projectId, "planned");
    otherRun = mkRun(projectId);
    otherJudge = Number(sql("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'P', 'jm', 'r', 'done')", otherRun).lastInsertRowid);
    const mkModel = (name: string) => Number(sql("INSERT INTO eval_run_models (run_id, provider_name, model) VALUES (?, 'P', ?)", runId, name).lastInsertRowid);
    modelA = mkModel("model-a");
    modelB = mkModel("model-b");
    const mkResult = (model: number, c: { id: number; case_key: string }, st: string, ms: number, cost: number | null) =>
      Number(sql("INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status, error, tokens_in, tokens_out, cost_usd, ms) VALUES (?, ?, ?, ?, ?, ?, ?, 10, 5, ?, ?)",
        runId, model, c.id, c.case_key, `ans-${c.case_key}`, st, st === "error" ? "boom" : "", cost, ms).lastInsertRowid);
    results = [100, 200, 300, 400].map((ms, i) => mkResult(modelA, cases[i], "ok", ms, 0.5));
    results.push(mkResult(modelB, cases[0], "ok", 50, null));
    results.push(mkResult(modelB, cases[1], "error", 0, 0.25));

    const addJudge = (status = "done") =>
      Number(sql("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'P', 'jm', 'the guide', ?)", runId, status).lastInsertRowid);
    const judge = (j: number, r: number, pass: number | null, st = "ok", score = pass ? 5 : 2) =>
      sql("INSERT INTO eval_judgements (judge_run_id, result_id, score, pass, reason, status) VALUES (?, ?, ?, ?, 'because', ?)", j, r, score, pass, st);
    oldJudge = addJudge();
    newJudge = addJudge();
    errJudge = addJudge();
    // old judge: A passes q1, q2, fails q3; B passes q1
    judge(oldJudge, results[0], 1); judge(oldJudge, results[1], 1); judge(oldJudge, results[2], 0); judge(oldJudge, results[4], 1);
    // newer judge: A fails everything judged
    judge(newJudge, results[0], 0); judge(newJudge, results[1], 0);
    // newest judge: errors only
    judge(errJudge, results[0], null, "error");
    sql("INSERT INTO eval_votes (result_id, verdict, note) VALUES (?, 'good', 'fine')", results[0]);
    sql("INSERT INTO eval_votes (result_id, verdict, note) VALUES (?, 'good', 'meh')", results[2]);
    sql("INSERT INTO eval_votes (result_id, verdict, note) VALUES (?, 'bad', '')", results[1]);
  });

  afterEach(async () => { await ctx.app.close(); });

  const report = (qs = "") => json(`/api/eval-runs/${runId}/report${qs}`);

  describe("routes", () => {
    it("uses the newest judge run with an ok judgement and skips one with only errors", async () => {
      const r = await report();
      expect(r.report.judge.id).toBe(newJudge);
      expect(r.judge_runs.map((j: any) => j.id)).toEqual([errJudge, newJudge, oldJudge]);
      expect(Object.keys(r.judge_runs[0]).sort()).toEqual(["created_at", "id", "model", "provider_name", "status"]);
    });

    it("uses an explicit older judge run", async () => {
      expect((await report(`?judge=${oldJudge}`)).report.judge.id).toBe(oldJudge);
    });

    it("refuses a judge run of another run, an unfinished run and a project with the Data factory off", async () => {
      expect((await get(`/api/eval-runs/${runId}/report?judge=${otherJudge}`)).statusCode).toBe(404);
      expect((await get(`/api/eval-runs/${runId}/report?judge=abc`)).statusCode).toBe(404);
      expect((await get(`/api/eval-runs/99999/report`)).statusCode).toBe(404);
      const p = await get(`/api/eval-runs/${planned}/report`);
      expect(p.statusCode).toBe(409);
      expect(p.json().error).toBe("This run has not finished yet");
      expect((await get(`/api/eval-runs/${offRunId}/report`)).statusCode).not.toBe(200);
    });

    it("sets the content type and file name on the downloads", async () => {
      for (const [ext, type] of [["md", "text/markdown"], ["csv", "text/csv"], ["json", "application/json"]]) {
        const res = await get(`/api/eval-runs/${runId}/report.${ext}`);
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe(`${type}; charset=utf-8`);
        expect(res.headers["content-disposition"]).toBe(`attachment; filename="run-${runId}-report.${ext}"`);
      }
      const j = JSON.parse((await get(`/api/eval-runs/${runId}/report.json`)).body);
      expect(j.schema_version).toBe(1);
      expect((await get(`/api/eval-runs/${runId}/report.json`)).body).toContain('\n  "schema_version"');
    });
  });

  describe("figures", () => {
    it("computes the figures of two models for the chosen judge run", async () => {
      const { report: r } = await report(`?judge=${oldJudge}`);
      const [a, b] = r.models;
      expect(a).toMatchObject({
        run_model_id: modelA, answers: 4, errors: 0, missing: 0, cost_usd: 2, cost_unknown: 0, avg_ms: 250, p95_ms: 400,
        judged: 3, passed: 2, pass_rate: 2 / 3, avg_score: 4, voted: 3, good: 2, good_rate: 2 / 3, compared: 3, agree: 1, agreement: 1 / 3,
      });
      expect(b).toMatchObject({
        answers: 1, errors: 1, missing: 2, cost_usd: 0.25, cost_unknown: 1, avg_ms: 50, p95_ms: 50, judged: 1, pass_rate: 1, voted: 0, good_rate: null, compared: 0, agreement: null,
      });
      expect(r.cases).toHaveLength(8);
      expect(r.cases.filter((c: any) => c.status === "missing")).toHaveLength(2);
      const missing = r.cases.find((c: any) => c.status === "missing");
      expect(missing).toMatchObject({ answer: "", error: "", tokens_in: 0, tokens_out: 0, cost_usd: null, ms: null, judge: null });
      expect(r.cases[0]).toMatchObject({ run_model_id: modelA, case_key: expect.any(String), agrees: true, vote: { verdict: "good", note: "fine" } });
    });

    it("has no judging figures when there is no judge run", async () => {
      sql("DELETE FROM eval_judge_runs WHERE run_id = ?", runId);
      const r = await report();
      expect(r.report.judge).toBeNull();
      expect(r.report.models[0]).toMatchObject({ judged: 0, pass_rate: null, avg_score: null, agreement: null, self_preference: false });
      expect(r.report.models[0].good_rate).toBe(2 / 3);
      expect(r.markdown).toContain("Not judged");
      expect(r.markdown).toMatch(/## Failed by the judge\n\nNone\./);
    });
  });

  describe("Markdown", () => {
    it("keeps an answer with backticks inside a longer fence", async () => {
      sql("UPDATE eval_results SET answer = ? WHERE id = ?", "x\n```js\ncode\n```\ny", results[2]);
      const md = (await report(`?judge=${oldJudge}`)).markdown as string;
      expect(md).toContain("````\nx\n```js\ncode\n```\ny\n````");
    });

    it("escapes inline text", async () => {
      sql("UPDATE eval_judgements SET reason = ? WHERE judge_run_id = ? AND result_id = ?", "bad | <img src=x>\nnext", oldJudge, results[2]);
      sql("UPDATE eval_cases SET case_key = ? WHERE id = (SELECT case_id FROM eval_results WHERE id = ?)", "k|<b>*", results[2]);
      const md = (await report(`?judge=${oldJudge}`)).markdown as string;
      expect(md).toContain("bad \\| &lt;img src=x> next");
      expect(md).not.toContain("<img");
    });

    it("lists all answers only when asked", async () => {
      expect((await report()).markdown).not.toContain("## All answers");
      expect((await report("?all=1")).markdown).toContain("## All answers");
      expect((await report("?all=0")).markdown).not.toContain("## All answers");
    });

    it("lists failures, disagreements and the notes", async () => {
      const md = (await report(`?judge=${oldJudge}`)).markdown as string;
      expect(md).toMatch(/## Failed by the judge\n\n### .* · model-a/);
      expect(md).toMatch(/## Errors\n\n### .* · model-b[\s\S]*boom/);
      expect(md).toContain("Your vote: Bad");
      expect(md).toContain("2 answers are missing.");
      expect(md).toContain("1 results have no known cost.");
      expect(md).toContain("Your votes cover 3 of 5 answers.");
      expect(md).toContain("## Scoring guide");
    });
  });

  describe("CSV", () => {
    it("guards formulas, keeps numbers bare and quotes commas and newlines", async () => {
      sql("UPDATE eval_results SET answer = ? WHERE id = ?", "=1+1", results[0]);
      sql("UPDATE eval_results SET answer = ? WHERE id = ?", "a,b\nc", results[1]);
      const res = await get(`/api/eval-runs/${runId}/report.csv?judge=${oldJudge}`);
      const csv = res.body;
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain(",'=1+1,");
      expect(csv).toContain('"a,b\nc"');
      expect(csv).toMatch(/,ok,5,true,because,good,fine,true\r\n/);
      expect(csv.split("\r\n")[0]).toBe("﻿run_id,run_name,dataset,version,judge_model,provider,model,case_key,tags,input,expected,answer,status,error,tokens_in,tokens_out,cost_usd,ms,judge_status,score,pass,judge_reason,vote,vote_note,agrees");
      expect(csv.endsWith("\r\n")).toBe(true);
    });
  });
});
