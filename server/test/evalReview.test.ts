import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";

describe("blind review", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number, offId: number, runId: number, offRunId: number, modelA: number, modelB: number, modelC: number;
  let results: number[]; // ok results of model A (4), then one of model B, then an error result of A

  const sql = (q: string, ...p: any[]) => ctx.db.prepare(q).run(...p);
  const addJudge = (model: string) =>
    Number(sql("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'P', ?, 'r', 'done')", runId, model).lastInsertRowid);
  const judge = (judgeId: number, resultId: number, pass: number | null, status = "ok", score = pass ? 5 : 2) =>
    sql("INSERT INTO eval_judgements (judge_run_id, result_id, score, pass, reason, status) VALUES (?, ?, ?, ?, 'because', ?)", judgeId, resultId, score, pass, status);

  beforeEach(async () => {
    const data = mkdtempSync(join(tmpdir(), "ad-rv-"));
    const repo = mkdtempSync(join(tmpdir(), "ad-rv-repo-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "# demo\n");
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const send = (method: string, url: string, payload?: unknown) =>
      ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } });
    call = async (m, u, p) => (await send(m, u, p)).json();
    status = async (m, u, p) => (await send(m, u, p)).statusCode;
    projectId = (await call("POST", "/api/projects", { name: "df", source: "local", path: repo, data_factory: 1 })).id;
    offId = (await call("POST", "/api/projects", { name: "off", source: "local", path: repo })).id;

    const d = await call("POST", `/api/projects/${projectId}/datasets`, {
      name: "set", format: "jsonl",
      text: [1, 2, 3, 4].map((n) => JSON.stringify({ input: `q${n}`, expected: `a${n}` })).join("\n"),
    });
    const versionId = d.version.id;
    const cases = ctx.db.prepare("SELECT id, case_key FROM eval_cases WHERE version_id = ? ORDER BY position").all(versionId) as { id: number; case_key: string }[];
    const mkRun = (project: number) => Number(sql(`INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status) VALUES (?, ?, 'r', '', 100, 'done')`, project, versionId).lastInsertRowid);
    runId = mkRun(projectId);
    offRunId = mkRun(offId);
    const mkModel = (name: string) => Number(sql("INSERT INTO eval_run_models (run_id, provider_name, model) VALUES (?, 'P', ?)", runId, name).lastInsertRowid);
    modelA = mkModel("model-a");
    modelB = mkModel("model-b");
    modelC = mkModel("model-c"); // no answers at all
    const mkResult = (model: number, c: { id: number; case_key: string }, st: string) =>
      Number(sql("INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status) VALUES (?, ?, ?, ?, ?, ?)", runId, model, c.id, c.case_key, `ans-${c.case_key}`, st).lastInsertRowid);
    results = [...cases.map((c) => mkResult(modelA, c, "ok")), mkResult(modelB, cases[0], "ok")];
    results.push(mkResult(modelB, cases[1], "error"));
    void modelC;
    sql("INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status) VALUES (?, ?, ?, 'x', '', 'ok')", offRunId, Number(sql("INSERT INTO eval_run_models (run_id, provider_name, model) VALUES (?, 'P', 'm')", offRunId).lastInsertRowid), cases[0].id);
  });

  afterEach(async () => { await ctx.app.close(); });

  const list = (qs = "") => call("GET", `/api/eval-runs/${runId}/review${qs}`);

  it("hides the reference and the judge until the vote, then shows them", async () => {
    judge(addJudge("jm"), results[0], 1);
    const before = await list();
    expect(before.total).toBe(5);
    expect(before.voted).toBe(0);
    const first = before.items[0];
    expect(first).toMatchObject({ result_id: results[0], input: "q1", answer: expect.any(String), vote: null, expected: null, judge: null, agrees: null });
    expect(Object.keys(first)).toContain("expected");

    const voted = await call("PUT", `/api/eval-results/${results[0]}/vote`, { verdict: "good", note: "fine" });
    expect(voted).toMatchObject({ vote: { verdict: "good", note: "fine" }, expected: "a1", agrees: true, judge: { score: 5, pass: true, reason: "because", judge_model: "jm" } });
    const after = await list();
    expect(after.voted).toBe(1);
    expect(after.items[0].expected).toBe("a1");
    expect(after.items[1]).toMatchObject({ vote: null, expected: null, judge: null, agrees: null });
  });

  it("voted item without a judge has judge null and agrees null", async () => {
    const v = await call("PUT", `/api/eval-results/${results[1]}/vote`, { verdict: "bad" });
    expect(v).toMatchObject({ expected: "a2", judge: null, agrees: null, vote: { verdict: "bad", note: "" } });
  });

  it("creates, changes and deletes a vote, and checks the input", async () => {
    const url = `/api/eval-results/${results[0]}/vote`;
    await call("PUT", url, { verdict: "good" });
    const changed = await call("PUT", url, { verdict: "bad", note: "x".repeat(500) });
    expect(changed.vote).toEqual({ verdict: "bad", note: "x".repeat(500) });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_votes").get()).toEqual({ n: 1 });
    expect(await status("PUT", url, { verdict: "bad", note: "x".repeat(501) })).toBe(400);
    expect(await status("PUT", url, { verdict: "maybe" })).toBe(400);
    expect(await status("PUT", `/api/eval-results/${results[5]}/vote`, { verdict: "good" })).toBe(409);
    expect(await status("PUT", "/api/eval-results/99999/vote", { verdict: "good" })).toBe(404);
    expect(await call("DELETE", url)).toEqual({ ok: true });
    expect(await call("DELETE", url)).toEqual({ ok: true });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_votes").get()).toEqual({ n: 0 });
    expect((await list()).items[0].vote).toBeNull();
  });

  it("refuses unknown runs, and projects with the Data factory off", async () => {
    expect(await status("GET", "/api/eval-runs/99999/review")).toBe(404);
    expect(await status("GET", "/api/eval-runs/99999/review-summary")).toBe(404);
    expect(await status("GET", `/api/eval-runs/${offRunId}/review`)).toBe(409);
    expect(await status("GET", `/api/eval-runs/${offRunId}/review-summary`)).toBe(409);
    const offResult = (ctx.db.prepare("SELECT id FROM eval_results WHERE run_id = ?").get(offRunId) as { id: number }).id;
    expect(await status("PUT", `/api/eval-results/${offResult}/vote`, { verdict: "good" })).toBe(409);
    expect(await status("DELETE", `/api/eval-results/${offResult}/vote`)).toBe(409);
  });

  it("filters by model and by unvoted, and pages", async () => {
    expect((await list(`?model=${modelB}`)).total).toBe(1); // the error answer is left out
    expect((await list(`?model=${modelC}`)).items).toEqual([]);
    await call("PUT", `/api/eval-results/${results[0]}/vote`, { verdict: "good" });
    await call("PUT", `/api/eval-results/${results[2]}/vote`, { verdict: "good" });
    const unvoted = await list("?unvoted=1");
    expect(unvoted.items.map((i: any) => i.result_id)).toEqual([results[1], results[3], results[4]]);
    expect(unvoted.total).toBe(5);
    expect(unvoted.voted).toBe(2);
    const page = await list("?offset=1&limit=2");
    expect(page.items.map((i: any) => i.result_id)).toEqual([results[1], results[2]]);
    expect((await list("?limit=-3")).items).toHaveLength(1);
    expect((await list("?limit=1000")).items).toHaveLength(5);
  });

  it("uses the ok judgement of the newest judge run that has one", async () => {
    const old = addJudge("old-judge");
    const newer = addJudge("new-judge");
    judge(old, results[0], 1);
    judge(newer, results[0], null, "error");            // errored newer judgement does not hide the older ok one
    judge(old, results[1], 1);
    judge(newer, results[1], 0);                        // newer ok judgement wins
    const a = await call("PUT", `/api/eval-results/${results[0]}/vote`, { verdict: "good" });
    expect(a.judge).toMatchObject({ judge_model: "old-judge", pass: true });
    const b = await call("PUT", `/api/eval-results/${results[1]}/vote`, { verdict: "good" });
    expect(b.judge).toMatchObject({ judge_model: "new-judge", pass: false });
    expect(b.agrees).toBe(false);
  });

  it("agrees: pass/good, pass/bad, fail/bad", async () => {
    const j = addJudge("jm");
    judge(j, results[0], 1);
    judge(j, results[1], 1);
    judge(j, results[2], 0);
    expect((await call("PUT", `/api/eval-results/${results[0]}/vote`, { verdict: "good" })).agrees).toBe(true);
    expect((await call("PUT", `/api/eval-results/${results[1]}/vote`, { verdict: "bad" })).agrees).toBe(false);
    expect((await call("PUT", `/api/eval-results/${results[2]}/vote`, { verdict: "bad" })).agrees).toBe(true);
  });

  it("lists voted answers only, filters by agreement and model, and pages", async () => {
    const url = (qs = "") => `/api/eval-runs/${runId}/review-votes${qs}`;
    expect(await call("GET", url())).toEqual({ total: 0, items: [] });
    const j = addJudge("jm");
    judge(j, results[0], 1);
    judge(j, results[1], 1);
    judge(j, results[4], 0);
    await call("PUT", `/api/eval-results/${results[0]}/vote`, { verdict: "good" }); // agrees
    await call("PUT", `/api/eval-results/${results[1]}/vote`, { verdict: "bad" });  // disagrees
    await call("PUT", `/api/eval-results/${results[3]}/vote`, { verdict: "good" }); // no judgement
    await call("PUT", `/api/eval-results/${results[4]}/vote`, { verdict: "good" }); // model B, disagrees
    const ids = async (qs = "") => (await call("GET", url(qs))).items.map((i: any) => i.result_id);
    const all = await call("GET", url());
    expect(all.total).toBe(4);
    expect(all.items[0]).toMatchObject({ result_id: results[0], input: "q1", expected: "a1", vote: { verdict: "good" }, judge: { pass: true, judge_model: "jm" }, agrees: true });
    expect(all.items[0].provider_name).toBe("P");
    expect(await ids()).toEqual([results[0], results[4], results[1], results[3]]); // position, then model
    expect(await ids("?agreement=agree")).toEqual([results[0]]);
    expect(await ids("?agreement=disagree")).toEqual([results[4], results[1]]);
    expect(await ids("?agreement=no_judge")).toEqual([results[3]]);
    expect(await ids("?agreement=weird")).toEqual(await ids());
    expect(await ids(`?model=${modelB}`)).toEqual([results[4]]);
    const page = await call("GET", url("?offset=1&limit=2"));
    expect(page.total).toBe(4);
    expect(page.items.map((i: any) => i.result_id)).toEqual([results[4], results[1]]);
    expect((await call("GET", url("?agreement=disagree&limit=1"))).total).toBe(2);
    expect(await status("GET", "/api/eval-runs/99999/review-votes")).toBe(404);
    expect(await status("GET", `/api/eval-runs/${offRunId}/review-votes`)).toBe(409);
  });

  it("summarises per model, including a model with no votes and a run with no judge", async () => {
    const empty = await call("GET", `/api/eval-runs/${runId}/review-summary`);
    expect(empty).toMatchObject({ answers: 5, voted: 0, good: 0, bad: 0, good_rate: null, compared: 0, agree: 0, agreement: null });
    expect(empty.models.map((m: any) => m.model)).toEqual(["model-a", "model-b", "model-c"]);
    expect(empty.models[2]).toMatchObject({ answers: 0, voted: 0, good_rate: null, agreement: null });

    const j = addJudge("jm");
    judge(j, results[0], 1);
    judge(j, results[1], 1);
    judge(j, results[2], 0);
    await call("PUT", `/api/eval-results/${results[0]}/vote`, { verdict: "good" }); // agrees
    await call("PUT", `/api/eval-results/${results[1]}/vote`, { verdict: "bad" });  // disagrees
    await call("PUT", `/api/eval-results/${results[2]}/vote`, { verdict: "bad" });  // agrees
    await call("PUT", `/api/eval-results/${results[3]}/vote`, { verdict: "good" }); // no judgement
    const s = await call("GET", `/api/eval-runs/${runId}/review-summary`);
    expect(s).toMatchObject({ answers: 5, voted: 4, good: 2, bad: 2, good_rate: 0.5, compared: 3, agree: 2 });
    expect(s.agreement).toBeCloseTo(2 / 3);
    const [a, b, c] = s.models;
    expect(a).toMatchObject({ run_model_id: modelA, provider_name: "P", answers: 4, voted: 4, good: 2, bad: 2, good_rate: 0.5, compared: 3, agree: 2 });
    expect(b).toMatchObject({ answers: 1, voted: 0, good_rate: null, compared: 0, agreement: null });
    expect(c).toMatchObject({ answers: 0, voted: 0 });
  });
});
