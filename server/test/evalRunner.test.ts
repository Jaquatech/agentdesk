import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { demoAnswer, evalHooks } from "../src/dataFactory/evalCall.ts";
import { runFinished } from "../src/dataFactory/runner.ts";
import type { ChatRequest, ChatResponse } from "../src/providers/types.ts";

const USAGE = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
const CALL_COST = (1000 * 3 + 100 * 15) / 1e6; // rp-model: $3 in, $15 out per million tokens

describe("demoAnswer", () => {
  it("is deterministic, mostly right, and answers a case without expected text", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `case-${i}`);
    const answers = keys.map((k) => demoAnswer("m", k, "in", "the answer"));
    expect(keys.map((k) => demoAnswer("m", k, "in", "the answer"))).toEqual(answers);
    const right = answers.filter((a) => a === "the answer").length;
    expect(right).toBeGreaterThan(20);
    expect(right).toBeLessThan(40);
    expect(demoAnswer("m", "k", "x".repeat(100), null)).toBe(`Demo answer to: ${"x".repeat(60)}`);
  });
});

describe("eval runner", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number, versionId: number, priced: number, free: number, unpriced: number;

  const jsonl = (n: number) => Array.from({ length: n }, (_, i) => JSON.stringify({ input: `question ${i}`, expected: `answer ${i}` })).join("\n");
  const count = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
  const ok = async (req: ChatRequest): Promise<ChatResponse> => ({ content: [{ type: "text", text: `re: ${req.messages[0].content[0].type === "text" ? (req.messages[0].content[0] as { text: string }).text : ""}` }], stopReason: "end", usage: USAGE });
  const fake = (chat: (req: ChatRequest) => Promise<ChatResponse>) => { evalHooks.chat = { chat, listModels: async () => [] }; };
  const dataset = async (n: number) => (await call("POST", `/api/projects/${projectId}/datasets`, { name: `set${n}-${Math.random()}`, format: "jsonl", text: jsonl(n) })).version.id as number;
  /** Plans a run and returns its id. */
  const plan = async (extra: object = {}) =>
    (await call("POST", `/api/projects/${projectId}/runs`, { version_id: versionId, model_ids: [priced], max_tokens: 100, cap_usd: 1, ...extra })).id as number;
  const start = (id: number, body: object = {}) => call("POST", `/api/eval-runs/${id}/start`, body);
  const run = (id: number) => ctx.db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(id) as any;
  const until = async (f: () => boolean) => { for (let i = 0; i < 500 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); expect(f()).toBe(true); };

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-er-"));
    repo = mkdtempSync(join(tmpdir(), "ad-er-repo-"));
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
    const prov = (name: string, kind: string) =>
      Number(ctx.db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES (?, ?, '', 'm')").run(name, kind).lastInsertRowid);
    const a = prov("A", "anthropic"), o = prov("O", "ollama");
    priced = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: a, model: "rp-model" })).id;
    free = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: o, model: "local-llm" })).id;
    unpriced = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: a, model: "no-price" })).id;
    versionId = await dataset(3);
    fake(ok);
  });

  afterEach(async () => {
    delete evalHooks.chat;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("answers every case with every model and records each call in runs", async () => {
    const id = await plan({ model_ids: [priced, free] });
    expect(await start(id)).toEqual({ ok: true });
    await runFinished(id);
    expect(run(id)).toMatchObject({ status: "done", stop_reason: "" });
    expect(run(id).started_at).toBeTruthy();
    expect(run(id).ended_at).toBeTruthy();
    expect(count("SELECT COUNT(*) AS n FROM eval_results")).toBe(6);

    const eval_ = ctx.db.prepare("SELECT project_id, model, engine, status, cost_usd, tokens_in, summary, agent_id FROM runs WHERE kind = 'eval' ORDER BY id").all() as any[];
    expect(eval_).toHaveLength(6);
    const paid = eval_.filter((r) => r.model === "rp-model");
    expect(paid).toHaveLength(3);
    for (const r of paid) expect(r).toMatchObject({ project_id: projectId, engine: "anthropic", status: "ok", tokens_in: 1000, agent_id: null });
    expect(paid[0].cost_usd).toBeCloseTo(CALL_COST, 9);
    expect(paid[0].summary).toMatch(/^eval: /);
    expect(eval_.filter((r) => r.model === "local-llm").every((r) => r.cost_usd === 0)).toBe(true);
    expect(run(id).cost_usd).toBeCloseTo(CALL_COST * 3, 9);

    const detail = await call("GET", `/api/eval-runs/${id}`);
    expect(detail.progress).toMatchObject({ total_calls: 6, done_calls: 6, error_calls: 0 });
    const rows = await call("GET", `/api/eval-runs/${id}/results`);
    expect(rows.map((r: any) => [r.model, r.input])).toEqual([
      ...[0, 1, 2].map((i) => ["rp-model", `question ${i}`]), ...[0, 1, 2].map((i) => ["local-llm", `question ${i}`]),
    ]);
    expect(rows[0]).toMatchObject({ provider_name: "A", answer: "re: question 0", expected: "answer 0", status: "ok", tokens_in: 1000, tokens_out: 100 });
    const second = await call("GET", `/api/eval-runs/${id}/results?model=${detail.models[1].id}&offset=1&limit=1`);
    expect(second.map((r: any) => r.input)).toEqual(["question 1"]);
  });

  it("refuses a start that is not allowed", async () => {
    const noPrice = await plan({ model_ids: [unpriced] });
    expect(await status("POST", `/api/eval-runs/${noPrice}/start`, {})).toBe(400);
    expect((await start(noPrice)).error).toMatch(/no-price.*Set a price on the Models tab/);
    const noCap = await plan({ cap_usd: null });
    expect((await start(noCap)).error).toBe("Set a cost cap for this run");

    const over = await plan({ cap_usd: 0.000001 });
    expect(await status("POST", `/api/eval-runs/${over}/start`, {})).toBe(409);
    expect(run(over).status).toBe("planned");
    expect(await start(over, { confirm_over_cap: true })).toEqual({ ok: true });
    await runFinished(over);
    expect(await status("POST", `/api/eval-runs/${over}/start`, {})).toBe(409);
    expect(await status("POST", "/api/eval-runs/9999/start", {})).toBe(404);
    expect(count("SELECT COUNT(*) AS n FROM runs WHERE kind = 'eval'")).toBeGreaterThan(0);
  });

  it("starts a run of an all-zero-price model without a cap", async () => {
    ctx.db.prepare("INSERT OR REPLACE INTO model_prices (model, price_in, price_out, cache_read, cache_write) VALUES ('zero-model', 0, 0, 0, 0)").run();
    const a = Number((ctx.db.prepare("SELECT id FROM providers WHERE name = 'A'").get() as { id: number }).id);
    const zero = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: a, model: "zero-model" })).id;
    const id = await plan({ model_ids: [zero], cap_usd: null });
    expect(await start(id)).toEqual({ ok: true });
  });

  it("stops when the cost reaches the cap", async () => {
    versionId = await dataset(8);
    const id = await plan({ cap_usd: CALL_COST * 2.5 });
    expect(await start(id, { confirm_over_cap: true })).toEqual({ ok: true });
    await runFinished(id);
    expect(run(id)).toMatchObject({ status: "stopped" });
    expect(run(id).stop_reason).toMatch(/^Cost cap reached \(\$0\.\d\d of \$0\.\d\d\)\.$/);
    expect(run(id).cost_usd).toBeGreaterThanOrEqual(CALL_COST * 2.5);
    expect(count("SELECT COUNT(*) AS n FROM eval_results")).toBeLessThan(8);
  });

  it("allows one running run, at most two calls in flight, and Stop", async () => {
    versionId = await dataset(6);
    let inFlight = 0, peak = 0, calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fake(async (req) => {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      await gate;
      inFlight--;
      return ok(req);
    });
    const first = await plan();
    const second = await plan();
    expect(await start(first)).toEqual({ ok: true });
    await until(() => calls === 2);
    expect((await start(second)).error).toBe("Another run is in progress");
    expect(await status("POST", `/api/eval-runs/${first}/stop`)).toBe(200);
    expect(run(first)).toMatchObject({ status: "stopped", stop_reason: "Stopped by you." });
    expect(await status("POST", `/api/eval-runs/${first}/stop`)).toBe(409);
    release();
    await runFinished(first);
    expect(peak).toBe(2);
    expect(calls).toBe(2);
    expect(run(first).status).toBe("stopped");
    expect(count("SELECT COUNT(*) AS n FROM eval_results")).toBeLessThanOrEqual(2);
  });

  it("fails the run after five errors in a row on one model", async () => {
    versionId = await dataset(10);
    fake(async () => { throw new Error("boom"); });
    const id = await plan();
    await start(id);
    await runFinished(id);
    expect(run(id).status).toBe("failed");
    expect(run(id).stop_reason).toContain("rp-model");
    expect(run(id).stop_reason).toContain("boom");
    expect(count("SELECT COUNT(*) AS n FROM eval_results WHERE status = 'error'")).toBeLessThan(10);
    expect(ctx.db.prepare("SELECT status, summary FROM runs WHERE kind = 'eval'").get()).toEqual({ status: "error", summary: "boom" });
  });

  it("keeps going past single errors", async () => {
    let n = 0;
    fake(async (req) => { if (n++ === 1) throw new Error("once"); return ok(req); });
    const id = await plan();
    await start(id);
    await runFinished(id);
    expect(run(id).status).toBe("done");
    expect(count("SELECT COUNT(*) AS n FROM eval_results WHERE status = 'error' AND error = 'once'")).toBe(1);
  });

  it("stops with the message when the daily budget is used up", async () => {
    versionId = await dataset(8);
    ctx.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('budget_day_usd', ?)").run(String(CALL_COST * 1.5));
    const id = await plan();
    await start(id);
    await runFinished(id);
    expect(run(id).status).toBe("stopped");
    expect(run(id).stop_reason).toMatch(/^Budget reached: /);
    expect(count("SELECT COUNT(*) AS n FROM eval_results")).toBeLessThan(8);
  });

  it("marks a run left running as interrupted when the server starts", async () => {
    const id = await plan();
    ctx.db.prepare("UPDATE eval_runs SET status = 'running' WHERE id = ?").run(id);
    const again = await buildApp({ dataDir: data });
    expect(again.db.prepare("SELECT status, stop_reason, ended_at FROM eval_runs WHERE id = ?").get(id)).toMatchObject({ status: "interrupted", stop_reason: "The server was restarted." });
    expect((again.db.prepare("SELECT ended_at FROM eval_runs WHERE id = ?").get(id) as any).ended_at).toBeTruthy();
    await again.app.close();
  });
});
