import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { evalHooks } from "../src/dataFactory/evalCall.ts";
import { runFinished } from "../src/dataFactory/runner.ts";
import { interruptJudges, judgeFinished } from "../src/dataFactory/judgeRunner.ts";
import type { ChatRequest, ChatResponse } from "../src/providers/types.ts";

const USAGE = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
const CALL_COST = (1000 * 3 + 100 * 15) / 1e6; // $3 in, $15 out per million tokens

const textOf = (req: ChatRequest) => (req.messages[0].content[0] as { text: string }).text;
const reply = (text: string): ChatResponse => ({ content: [{ type: "text", text }], stopReason: "end", usage: USAGE });
const isJudge = (req: ChatRequest) => req.system.includes("Reply with one JSON object");
const good = (score: number, pass: boolean) => JSON.stringify({ score, pass, reason: `score ${score}` });

describe("judge runner", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number, versionId: number, testA: number, testB: number, judge: number, unpriced: number, noJudge: number;

  const jsonl = (n: number) => Array.from({ length: n }, (_, i) => JSON.stringify({ input: `question ${i}`, expected: `answer ${i}` })).join("\n");
  const fake = (chat: (req: ChatRequest) => Promise<ChatResponse>) => { evalHooks.chat = { chat, listModels: async () => [] }; };
  /** Runs answer "re: ..."; the judge gives each case a verdict by its question. */
  const scripted = async (req: ChatRequest) => {
    if (!isJudge(req)) return reply(`re: ${textOf(req)}`);
    const t = textOf(req);
    if (t.includes("question 0")) return reply(good(5, true));
    if (t.includes("question 1")) return reply(good(2, false));
    if (t.includes("question 2")) return reply("I cannot decide.");
    return reply(good(4, true));
  };
  const until = async (f: () => boolean) => { for (let i = 0; i < 500 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); expect(f()).toBe(true); };
  const count = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...(a as any[])) as { n: number }).n;
  const judgeRow = (id: number) => ctx.db.prepare("SELECT * FROM eval_judge_runs WHERE id = ?").get(id) as any;

  /** A finished run of the given models over a dataset of n cases. */
  const finishedRun = async (n = 3, models = [testA]) => {
    const vid = n === 3 ? versionId : (await call("POST", `/api/projects/${projectId}/datasets`, { name: `set${n}`, format: "jsonl", text: jsonl(n) })).version.id;
    const id = (await call("POST", `/api/projects/${projectId}/runs`, { version_id: vid, model_ids: models, max_tokens: 100, cap_usd: 1 })).id as number;
    await call("POST", `/api/eval-runs/${id}/start`, {});
    await runFinished(id);
    return id;
  };
  const startJudge = (runId: number, body: object = {}) => call("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: judge, cap_usd: 1, ...body });

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-jr-"));
    repo = mkdtempSync(join(tmpdir(), "ad-jr-repo-"));
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
    ctx.db.prepare("INSERT OR REPLACE INTO model_prices (model, price_in, price_out) VALUES ('rp-model', 3, 15)").run();
    ctx.db.prepare("INSERT OR REPLACE INTO model_prices (model, price_in, price_out) VALUES ('jd-model', 3, 15)").run();
    const prov = (name: string, kind: string) =>
      Number(ctx.db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES (?, ?, '', 'm')").run(name, kind).lastInsertRowid);
    const a = prov("A", "anthropic"), o = prov("O", "ollama");
    const model = async (p: number, m: string, forTest: boolean, forJudge: boolean) =>
      (await call("POST", `/api/projects/${projectId}/models`, { provider_id: p, model: m, for_test: forTest, for_judge: forJudge })).id as number;
    testA = await model(a, "rp-model", true, false);
    testB = await model(o, "local-llm", true, false);
    judge = await model(a, "jd-model", false, true);
    unpriced = await model(a, "no-price", false, true);
    noJudge = testA;
    versionId = (await call("POST", `/api/projects/${projectId}/datasets`, { name: "set3", format: "jsonl", text: jsonl(3) })).version.id;
    fake(scripted);
  });

  afterEach(async () => {
    delete evalHooks.chat;
    delete process.env.AGENTDESK_DEMO;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("judges every ok result, records usage of kind judge and ends done", async () => {
    const runId = await finishedRun();
    const started = await startJudge(runId);
    expect(started.id).toBeGreaterThan(0);
    await judgeFinished(started.id);
    const j = judgeRow(started.id);
    expect(j).toMatchObject({ status: "done", stop_reason: "", model: "jd-model", provider_name: "A", max_tokens: 300 });
    expect(j.rubric).toMatch(/strict grader/);
    expect(j.ended_at).toBeTruthy();
    expect(count("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ?", started.id)).toBe(3);
    expect(j.cost_usd).toBeCloseTo(3 * CALL_COST, 9);
    const usage = ctx.db.prepare("SELECT status, cost_usd, summary FROM runs WHERE kind = 'judge'").all() as any[];
    expect(usage).toHaveLength(3);
    expect(usage[0]).toMatchObject({ status: "ok" });
    expect(usage[0].summary).toMatch(/^judge: /);
    expect(count("SELECT COUNT(*) AS n FROM runs WHERE kind = 'eval'")).toBe(3);
    const g = ctx.db.prepare("SELECT score, pass, reason, status FROM eval_judgements WHERE judge_run_id = ? ORDER BY id").all(started.id) as any[];
    expect(g.filter((x) => x.status === "ok").map((x) => [x.score, x.pass]).sort()).toEqual([[2, 0], [5, 1]]);
  });

  it("stores an unreadable reply as an error row and goes on; the summary counts it out", async () => {
    const runId = await finishedRun(3, [testA, testB]);
    const { id } = await startJudge(runId);
    await judgeFinished(id);
    expect(judgeRow(id).status).toBe("done");
    const bad = ctx.db.prepare("SELECT status, error, score, pass FROM eval_judgements WHERE judge_run_id = ? AND status = 'error'").all(id) as any[];
    expect(bad).toHaveLength(2);
    expect(bad[0].error).toMatch(/Could not read a judgement/);
    expect(bad[0].score).toBeNull();
    const one = await call("GET", `/api/judge-runs/${id}`);
    expect(one).toMatchObject({ status: "done", done_calls: 6, error_calls: 2, total_calls: 6, provider_name: "A", model: "jd-model" });
    expect(one.summary).toHaveLength(2);
    for (const s of one.summary) expect(s).toMatchObject({ judged: 2, avg_score: 3.5, pass_rate: 0.5, errors: 1 });
    expect(one.summary.map((s: any) => s.model)).toEqual(["rp-model", "local-llm"]);
    const list = await call("GET", `/api/eval-runs/${runId}/judge-runs`);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
  });

  it("fails after five errors in a row with the last error", async () => {
    const runId = await finishedRun(8);
    fake(async (req) => { if (isJudge(req)) throw new Error("judge is down"); return reply("x"); });
    const { id } = await startJudge(runId);
    await judgeFinished(id);
    const j = judgeRow(id);
    expect(j.status).toBe("failed");
    expect(j.stop_reason).toMatch(/failed 5 times in a row.*judge is down/);
    expect(count("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ? AND status = 'error'", id)).toBeGreaterThanOrEqual(5);
  });

  it("stops at the cost cap", async () => {
    const runId = await finishedRun(8);
    const { id } = await startJudge(runId, { cap_usd: 0.005, confirm_over_cap: true });
    await judgeFinished(id);
    const j = judgeRow(id);
    expect(j.status).toBe("stopped");
    expect(j.stop_reason).toMatch(/^Cost cap reached/);
    expect(count("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ?", id)).toBeLessThan(8);
  });

  it("stops at once and leaves no row for an aborted call", async () => {
    const runId = await finishedRun();
    let started = 0;
    fake((req) => new Promise((_, rej) => { started++; req.signal?.addEventListener("abort", () => rej(new Error("aborted"))); }));
    const { id } = await startJudge(runId);
    await until(() => started === 2);
    expect(await call("POST", `/api/judge-runs/${id}/stop`)).toEqual({ ok: true });
    await judgeFinished(id);
    expect(judgeRow(id)).toMatchObject({ status: "stopped", stop_reason: "Stopped by you." });
    expect(count("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ?", id)).toBe(0);
    expect(await status("POST", `/api/judge-runs/${id}/stop`)).toBe(409);
  });

  it("refuses what cannot be judged", async () => {
    const runId = await finishedRun();
    expect(await status("POST", "/api/eval-runs/9999/judge", { eval_model_id: judge, cap_usd: 1 })).toBe(404);
    expect(await status("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: noJudge, cap_usd: 1 })).toBe(400);
    expect(await status("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: judge, cap_usd: 0 })).toBe(400);

    const planned = (await call("POST", `/api/projects/${projectId}/runs`, { version_id: versionId, model_ids: [testA], cap_usd: 1 })).id;
    const p = await call("POST", `/api/eval-runs/${planned}/judge`, { eval_model_id: judge, cap_usd: 1 });
    expect(p.error).toBe("Judge a run after it has ended");
    ctx.db.prepare("UPDATE eval_runs SET status = 'done' WHERE id = ?").run(planned);
    expect(await status("POST", `/api/eval-runs/${planned}/judge`, { eval_model_id: judge, cap_usd: 1 })).toBe(409); // no ok results

    const missing = await call("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: unpriced, cap_usd: 1 });
    expect(missing.error).toMatch(/^No price for no-price/);
    const needsCap = await call("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: judge });
    expect(needsCap.error).toBe("Set a cost cap for this run");
    const over = await call("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: judge, cap_usd: 0.000001 });
    expect(over.error).toMatch(/above the cap/);
    expect(count("SELECT COUNT(*) AS n FROM eval_judge_runs")).toBe(0);

    ctx.db.prepare("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'A', 'jd-model', 'r', 'running')").run(runId);
    const busy = await call("POST", `/api/eval-runs/${runId}/judge`, { eval_model_id: judge, cap_usd: 1 });
    expect(busy.error).toBe("Another judge run is in progress");
  });

  it("estimates through the route and judges only ok results", async () => {
    const runId = await finishedRun();
    const bad = (ctx.db.prepare("SELECT id FROM eval_results WHERE run_id = ? ORDER BY id LIMIT 1").get(runId) as any).id;
    ctx.db.prepare("UPDATE eval_results SET status = 'error', answer = '', error = 'boom' WHERE id = ?").run(bad);
    const est = await call("POST", `/api/eval-runs/${runId}/judge/estimate`, { eval_model_id: judge, cap_usd: 1 });
    expect(est).toMatchObject({ calls: 2, status: "priced", needs_cap: false });
    expect(await status("POST", `/api/eval-runs/${runId}/judge/estimate`, { eval_model_id: judge, cap_usd: "x" })).toBe(400);
    const { id } = await startJudge(runId);
    await judgeFinished(id);
    expect(count("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ?", id)).toBe(2);
    expect((await call("GET", `/api/judge-runs/${id}`)).total_calls).toBe(2);
    expect(judgeRow(id).est_high).toBeGreaterThan(0);
  });

  it("marks running judge runs interrupted", () => {
    const runId = 1;
    ctx.db.prepare("INSERT INTO eval_runs (id, project_id, version_id, status) VALUES (?, ?, ?, 'done')").run(runId, projectId, versionId);
    ctx.db.prepare("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'A', 'm', 'r', 'running')").run(runId);
    interruptJudges(ctx.db);
    expect(ctx.db.prepare("SELECT status, stop_reason FROM eval_judge_runs").get()).toEqual({ status: "interrupted", stop_reason: "The server was restarted." });
  });

  it("filters and pages the judgement rows", async () => {
    const runId = await finishedRun(3, [testA, testB]);
    const { id } = await startJudge(runId);
    await judgeFinished(id);
    const all = await call("GET", `/api/judge-runs/${id}/results`);
    expect(all).toHaveLength(6);
    expect(all[0]).toMatchObject({ case_key: expect.any(String), input: "question 0", expected: "answer 0", model: "rp-model", provider_name: "A", score: 5, pass: 1, status: "ok" });
    expect(Object.keys(all[0]).sort()).toEqual(["answer", "case_key", "cost_usd", "error", "expected", "input", "model", "pass", "provider_name", "reason", "result_id", "score", "status"]);
    const rm = (ctx.db.prepare("SELECT id FROM eval_run_models WHERE run_id = ? AND model = 'local-llm'").get(runId) as any).id;
    const byModel = await call("GET", `/api/judge-runs/${id}/results?model=${rm}`);
    expect(byModel).toHaveLength(3);
    expect(byModel.every((r: any) => r.model === "local-llm")).toBe(true);
    expect(await call("GET", `/api/judge-runs/${id}/results?verdict=pass`)).toHaveLength(2);
    const fail = await call("GET", `/api/judge-runs/${id}/results?verdict=fail`);
    expect(fail).toHaveLength(2);
    expect(fail.every((r: any) => r.score === 2)).toBe(true);
    const p1 = await call("GET", `/api/judge-runs/${id}/results?limit=4`);
    const p2 = await call("GET", `/api/judge-runs/${id}/results?limit=4&offset=4`);
    expect(p1).toHaveLength(4);
    expect(p2).toHaveLength(2);
    expect([...p1, ...p2].map((r) => r.result_id)).toEqual(all.map((r: any) => r.result_id));
  });

  it("deletes a judge run unless it is running", async () => {
    const runId = await finishedRun();
    const { id } = await startJudge(runId);
    await judgeFinished(id);
    ctx.db.prepare("UPDATE eval_judge_runs SET status = 'running' WHERE id = ?").run(id);
    expect(await status("DELETE", `/api/judge-runs/${id}`)).toBe(409);
    ctx.db.prepare("UPDATE eval_judge_runs SET status = 'done' WHERE id = ?").run(id);
    expect(await call("DELETE", `/api/judge-runs/${id}`)).toEqual({ ok: true });
    expect(count("SELECT COUNT(*) AS n FROM eval_judgements")).toBe(0);
    expect(await status("GET", `/api/judge-runs/${id}`)).toBe(404);
  });

  it("judges with scripted replies in demo mode", async () => {
    process.env.AGENTDESK_DEMO = "1";
    delete evalHooks.chat;
    const runId = await finishedRun(8);
    const { id } = await startJudge(runId);
    await judgeFinished(id);
    expect(judgeRow(id).status).toBe("done");
    const rows = await call("GET", `/api/judge-runs/${id}/results?limit=200`);
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      if (r.answer === r.expected) expect(r).toMatchObject({ score: 5, pass: 1 });
      else expect(r).toMatchObject({ score: 2, pass: 0 });
    }
    expect(rows.some((r: any) => r.score === 5)).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM runs WHERE kind = 'judge'")).toBe(8);
  });
});
