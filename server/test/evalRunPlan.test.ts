import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { estimateRun, estimateTokens } from "../src/dataFactory/estimate.ts";
import type { ModelPrice } from "../src/pricing.ts";

const price: ModelPrice = { model: "p", price_in: 3, price_out: 15, cache_read: 0, cache_write: 0, long_threshold: 0, long_multiplier: 1, note: "", updated_at: "" } as ModelPrice;
const cases = [{ input: "abcdefgh", expected: "x".repeat(40) }, { input: "a".repeat(12), expected: null }];
const base = { cases, systemPrompt: "s".repeat(12), maxTokens: 100, capUsd: null as number | null };

describe("estimateRun", () => {
  it("counts tokens by characters", () => {
    expect(estimateTokens("abcdefgh", 4)).toBe(2);
    expect(estimateTokens("abcdefgh", 3)).toBe(3);
  });

  it("prices a model by hand", () => {
    const e = estimateRun({ ...base, models: [{ provider_name: "A", model: "p", price, free: false }] });
    // in: low 5 + 6, high 7 + 8; out: low 16 (expected is short) + 25 (maxTokens / 4), high 100 + 100
    expect(e.models[0]).toMatchObject({ status: "priced", calls: 2, in_tokens: { low: 11, high: 15 }, out_tokens: { low: 41, high: 200 } });
    expect(e.low).toBe(0.000648);
    expect(e.high).toBe(0.003045);
    expect(e.high).toBeGreaterThanOrEqual(e.low);
    expect(e.needs_cap).toBe(true);
    expect(e.over_cap).toBe(false);
  });

  it("free costs nothing, missing is listed and left out", () => {
    const e = estimateRun({ ...base, models: [
      { provider_name: "O", model: "local", price: null, free: true },
      { provider_name: "X", model: "nope", price: null, free: false },
    ] });
    expect(e.models.map((m) => m.status)).toEqual(["free", "missing"]);
    expect(e.low).toBe(0);
    expect(e.high).toBe(0);
    expect(e.missing).toEqual(["nope"]);
    expect(e.needs_cap).toBe(false);
  });

  it("expected text sets the low output, within 16 and maxTokens", () => {
    const one = (expected: string | null, maxTokens: number) =>
      estimateRun({ ...base, maxTokens, cases: [{ input: "a", expected }], models: [{ provider_name: "A", model: "p", price, free: false }] }).models[0].out_tokens;
    expect(one("x".repeat(400), 512)).toEqual({ low: 100, high: 512 });
    expect(one("x".repeat(4000), 512)).toEqual({ low: 512, high: 512 });
    expect(one("x", 512)).toEqual({ low: 16, high: 512 });
    expect(one(null, 512)).toEqual({ low: 128, high: 512 });
    expect(one(null, 32)).toEqual({ low: 16, high: 32 });
  });

  it("flags a cap that the high estimate passes", () => {
    const models = [{ provider_name: "A", model: "p", price, free: false }];
    const e = estimateRun({ ...base, capUsd: 0.001, models });
    expect(e.needs_cap).toBe(false);
    expect(e.over_cap).toBe(true);
    expect(estimateRun({ ...base, capUsd: 1, models }).over_cap).toBe(false);
  });
});

describe("run plans", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number, offId: number, versionId: number, datasetId: number;
  let priced: number, free: number, judgeOnly: number;

  const jsonl = (n: number) => Array.from({ length: n }, (_, i) => JSON.stringify({ input: `question ${i}`, expected: `answer ${i}` })).join("\n");
  const count = (t: string) => (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-rp-"));
    repo = mkdtempSync(join(tmpdir(), "ad-rp-repo-"));
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
    ctx.db.prepare("INSERT OR REPLACE INTO model_prices (model, price_in, price_out) VALUES ('rp-model', 3, 15)").run();
    const prov = (name: string, kind: string) =>
      Number(ctx.db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES (?, ?, '', 'm')").run(name, kind).lastInsertRowid);
    const a = prov("A", "anthropic"), o = prov("O", "ollama");
    priced = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: a, model: "rp-model" })).id;
    free = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: o, model: "local-llm" })).id;
    judgeOnly = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: a, model: "judge-x", for_test: false, for_judge: true })).id;
    const d = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(3) });
    datasetId = d.dataset_id;
    versionId = d.version.id;
  });

  afterEach(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const body = (extra: object = {}) => ({ version_id: versionId, model_ids: [priced, free], system_prompt: "Answer briefly.", max_tokens: 100, cap_usd: 1, ...extra });

  it("estimate saves nothing", async () => {
    const e = await call("POST", `/api/projects/${projectId}/runs/estimate`, body());
    expect(e.models.map((m: any) => m.status)).toEqual(["priced", "free"]);
    expect(e.high).toBeGreaterThan(0);
    expect(count("eval_runs")).toBe(0);
  });

  it("creates a run with a snapshot of its models", async () => {
    const r = await call("POST", `/api/projects/${projectId}/runs`, body({ name: " first " }));
    expect(r.estimate.high).toBeGreaterThan(0);
    const row = ctx.db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(r.id) as any;
    expect(row).toMatchObject({ name: "first", status: "planned", max_tokens: 100, cap_usd: 1, est_low: r.estimate.low, est_high: r.estimate.high, version_id: versionId });
    const models = ctx.db.prepare("SELECT provider_name, model FROM eval_run_models WHERE run_id = ? ORDER BY id").all(r.id);
    expect(models).toEqual([{ provider_name: "A", model: "rp-model" }, { provider_name: "O", model: "local-llm" }]);
    // The snapshot stays when the model list changes.
    await call("DELETE", `/api/eval-models/${priced}`);
    expect(count("eval_run_models")).toBe(2);
  });

  it("refuses bad plans", async () => {
    const url = `/api/projects/${projectId}/runs`;
    const other = await call("POST", "/api/projects", { name: "two", source: "local", path: repo, data_factory: 1 });
    const od = await call("POST", `/api/projects/${other.id}/datasets`, { name: "set", format: "jsonl", text: jsonl(1) });
    expect(await status("POST", url, body({ version_id: od.version.id }))).toBe(400);
    expect(await status("POST", url, body({ model_ids: [] }))).toBe(400);
    expect(await status("POST", url, body({ model_ids: [judgeOnly] }))).toBe(400);
    expect(await status("POST", url, body({ model_ids: [99999] }))).toBe(400);
    expect(await status("POST", url, body({ max_tokens: 8 }))).toBe(400);
    expect(await status("POST", url, body({ max_tokens: 9000 }))).toBe(400);
    expect(await status("POST", url, body({ cap_usd: 0 }))).toBe(400);
    expect(await status("POST", url, body({ system_prompt: "x".repeat(8001) }))).toBe(400);
    expect(await status("POST", url, body({ name: "n".repeat(121) }))).toBe(400);
    expect(await status("POST", `${url}/estimate`, body({ cap_usd: 0 }))).toBe(400);
    expect(count("eval_runs")).toBe(0);
  });

  it("refuses a version without cases", async () => {
    ctx.db.prepare("DELETE FROM eval_cases WHERE version_id = ?").run(versionId);
    expect(await status("POST", `/api/projects/${projectId}/runs`, body())).toBe(400);
  });

  it("is refused when the Data factory is off", async () => {
    expect(await status("POST", `/api/projects/${offId}/runs`, body())).toBe(409);
    expect(await status("POST", `/api/projects/${offId}/runs/estimate`, body())).toBe(409);
    expect(await status("GET", `/api/projects/${offId}/runs`)).toBe(409);
    const r = await call("POST", `/api/projects/${projectId}/runs`, body());
    ctx.db.prepare("UPDATE projects SET data_factory = 0 WHERE id = ?").run(projectId);
    expect(await status("GET", `/api/eval-runs/${r.id}`)).toBe(409);
    expect(await status("DELETE", `/api/eval-runs/${r.id}`)).toBe(409);
  });

  it("lists and gets runs", async () => {
    const r1 = await call("POST", `/api/projects/${projectId}/runs`, body({ name: "one" }));
    const r2 = await call("POST", `/api/projects/${projectId}/runs`, body({ name: "two", model_ids: [free] }));
    const list = await call("GET", `/api/projects/${projectId}/runs`);
    expect(list.map((r: any) => r.id)).toEqual([r2.id, r1.id]);
    expect(list[0]).toMatchObject({ name: "two", status: "planned", dataset_id: datasetId, dataset_name: "set", version: 1, case_count: 3, model_count: 1 });
    const one = await call("GET", `/api/eval-runs/${r1.id}`);
    expect(one).toMatchObject({ id: r1.id, dataset_name: "set", version: 1, system_prompt: "Answer briefly." });
    expect(one.models).toHaveLength(2);
    expect(one.estimate.high).toBe(r1.estimate.high);
    expect(await status("GET", "/api/eval-runs/99999")).toBe(404);
  });

  it("does not delete a running run, and a used dataset stays until its runs go", async () => {
    const r = await call("POST", `/api/projects/${projectId}/runs`, body());
    ctx.db.prepare("UPDATE eval_runs SET status = 'running' WHERE id = ?").run(r.id);
    expect(await status("DELETE", `/api/eval-runs/${r.id}`)).toBe(409);
    ctx.db.prepare("UPDATE eval_runs SET status = 'done' WHERE id = ?").run(r.id);

    expect(await status("DELETE", `/api/datasets/${datasetId}`)).toBe(409);
    expect(count("eval_datasets")).toBe(1);

    expect(await status("DELETE", `/api/eval-runs/${r.id}`)).toBe(200);
    expect(count("eval_run_models")).toBe(0);
    expect(await status("DELETE", `/api/datasets/${datasetId}`)).toBe(200);
    expect(count("eval_datasets")).toBe(0);
  });
});
