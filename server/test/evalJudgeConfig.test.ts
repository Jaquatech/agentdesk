import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { DEFAULT_RUBRIC, FORMAT_LINE, estimateJudge, judgeOptions, judgeSystem, judgeUser, parseJudgement } from "../src/dataFactory/judge.ts";
import type { ModelPrice } from "../src/pricing.ts";

const price: ModelPrice = { model: "p", price_in: 3, price_out: 15, cache_read: 0, cache_write: 0, long_threshold: 0, long_multiplier: 1, note: "", updated_at: "" } as ModelPrice;

describe("judge text", () => {
  it("has a short default rubric and a fixed format line", () => {
    expect(DEFAULT_RUBRIC.length).toBeLessThanOrEqual(700);
    expect(FORMAT_LINE.length).toBeLessThanOrEqual(200);
    expect(judgeSystem("")).toBe(`${DEFAULT_RUBRIC}\n\n${FORMAT_LINE}`);
    expect(judgeSystem("   ")).toBe(`${DEFAULT_RUBRIC}\n\n${FORMAT_LINE}`);
    const custom = judgeSystem("Be kind.");
    expect(custom.startsWith("Be kind.")).toBe(true);
    expect(custom.endsWith(FORMAT_LINE)).toBe(true);
    expect(custom).not.toContain(DEFAULT_RUBRIC);
  });

  it("builds the user message, with and without a reference", () => {
    const a = judgeUser({ input: "Q?", expected: "R", answer: "A" });
    expect(a).toContain("Question:\nQ?");
    expect(a).toContain("Reference answer:\nR");
    expect(a).toContain("Model answer:\nA");
    const b = judgeUser({ input: "Q?", expected: null, answer: "A" });
    expect(b).toContain("No reference answer was given.");
    expect(b).not.toContain("Reference answer:");
    const c = judgeUser({ input: "q", expected: "", answer: "x".repeat(7000) });
    expect(c).toContain("No reference answer was given.");
    expect(c).toContain("[cut]");
    expect(c.length).toBeLessThan(6500);
  });
});

describe("parseJudgement", () => {
  it("reads clean JSON", () => {
    expect(parseJudgement('{"score": 5, "pass": true, "reason": "ok"}')).toEqual({ ok: true, score: 5, pass: true, reason: "ok" });
  });
  it("finds JSON inside fences and words", () => {
    const r = parseJudgement('Here you go:\n```json\n{"score": 2, "pass": false, "reason": "wrong"}\n```\nDone.');
    expect(r).toEqual({ ok: true, score: 2, pass: false, reason: "wrong" });
  });
  it("accepts a string score and rounds", () => {
    expect(parseJudgement('{"score": "4", "pass": true, "reason": ""}')).toMatchObject({ ok: true, score: 4 });
    expect(parseJudgement('{"score": 3.6}')).toMatchObject({ ok: true, score: 4 });
  });
  it("derives a missing pass from the score", () => {
    expect(parseJudgement('{"score": 4}')).toMatchObject({ pass: true });
    expect(parseJudgement('{"score": 3}')).toMatchObject({ pass: false });
  });
  it("cuts a long reason", () => {
    const r = parseJudgement(JSON.stringify({ score: 5, reason: "r".repeat(2000) }));
    expect(r.ok && r.reason.length).toBe(1000);
  });
  it("refuses a bad score and text without JSON", () => {
    expect(parseJudgement('{"score": 0}').ok).toBe(false);
    expect(parseJudgement('{"score": 6}').ok).toBe(false);
    expect(parseJudgement('{"score": "high"}').ok).toBe(false);
    expect(parseJudgement('{"pass": true}').ok).toBe(false);
    const r = parseJudgement("z".repeat(500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("z".repeat(200));
    if (!r.ok) expect(r.error).not.toContain("z".repeat(201));
  });
});

describe("judgeOptions", () => {
  const m = (model: string, family: string) => ({ id: 1, provider_id: 1, provider_name: "A", model, family });
  it("puts other families first and warns when none is", () => {
    const r = judgeOptions([m("claude-x", "claude"), m("gpt-x", "openai")], ["claude"]);
    expect(r.models.map((x) => [x.model, x.same_family])).toEqual([["gpt-x", false], ["claude-x", true]]);
    expect(r.warning).toBeNull();
    const w = judgeOptions([m("claude-x", "claude")], ["claude"]);
    expect(w.warning).toContain("same family");
  });
  it("never counts unknown as the same family", () => {
    const r = judgeOptions([m("mystery", "unknown")], ["unknown"]);
    expect(r.models[0].same_family).toBe(false);
    expect(r.warning).toBeNull();
  });
  it("has no warning without models", () => {
    expect(judgeOptions([], ["claude"])).toEqual({ models: [], warning: null });
  });
});

describe("estimateJudge", () => {
  const results = [
    { input: "a".repeat(100), expected: "b", answer: "c".repeat(100), status: "ok" },
    { input: "q", expected: null, answer: "x", status: "ok" },
    { input: "q", expected: null, answer: "", status: "error" },
  ];
  const base = { results, rubric: "", maxTokens: 300, free: false };
  it("prices ok results only", () => {
    const e = estimateJudge({ ...base, price });
    expect(e.calls).toBe(2);
    expect(e.status).toBe("priced");
    expect(e.low).toBeGreaterThan(0);
    expect(e.high).toBeGreaterThan(e.low);
    expect(e.needs_cap).toBe(true);
    expect(e.over_cap).toBe(false);
  });
  it("flags a cap that high passes", () => {
    const e = estimateJudge({ ...base, price, capUsd: 0.0001 });
    expect(e.needs_cap).toBe(false);
    expect(e.over_cap).toBe(true);
  });
  it("treats an all-zero price and free as free", () => {
    for (const p of [{ price: { ...price, price_in: 0, price_out: 0 }, free: false }, { price: null, free: true }]) {
      const e = estimateJudge({ ...base, ...p });
      expect(e).toMatchObject({ status: "free", low: 0, high: 0, needs_cap: false, over_cap: false });
    }
  });
  it("a missing price adds nothing", () => {
    const e = estimateJudge({ ...base, price: null });
    expect(e).toMatchObject({ status: "missing", calls: 2, low: 0, high: 0, needs_cap: false });
  });
});

describe("judge routes", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number, offId: number, runId: number, prov: number;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-jc-"));
    repo = mkdtempSync(join(tmpdir(), "ad-jc-repo-"));
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
    prov = Number(ctx.db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES ('A', 'anthropic', '', 'm')").run().lastInsertRowid);
    const d = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: JSON.stringify({ input: "q", expected: "a" }) });
    await call("POST", `/api/dataset-versions/${d.version.id}/approve`, {});
    const tested = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: prov, model: "claude-tested" })).id;
    runId = (await call("POST", `/api/projects/${projectId}/runs`, { version_id: d.version.id, model_ids: [tested] })).id;
  });

  afterEach(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns the default, stores a custom rubric and goes back to default", async () => {
    const url = `/api/projects/${projectId}/judge`;
    expect(await call("GET", url)).toEqual({ rubric: DEFAULT_RUBRIC, is_default: true, default_rubric: DEFAULT_RUBRIC, format_line: FORMAT_LINE });
    const put = await call("PUT", url, { rubric: "Grade hard." });
    expect(put).toMatchObject({ rubric: "Grade hard.", is_default: false });
    expect(await call("GET", url)).toMatchObject({ rubric: "Grade hard.", is_default: false });
    expect(await call("PUT", url, { rubric: "   " })).toMatchObject({ rubric: DEFAULT_RUBRIC, is_default: true });
    expect((ctx.db.prepare("SELECT rubric FROM eval_judge_config WHERE project_id = ?").get(projectId) as any).rubric).toBe("");
  });

  it("refuses a long or non-text rubric", async () => {
    const url = `/api/projects/${projectId}/judge`;
    expect(await status("PUT", url, { rubric: "x".repeat(4001) })).toBe(400);
    expect(await status("PUT", url, { rubric: "x".repeat(4000) })).toBe(200);
    expect(await status("PUT", url, { rubric: 5 })).toBe(400);
  });

  it("answers 409 with the Data factory off and 404 for unknown ids", async () => {
    expect(await status("GET", `/api/projects/${offId}/judge`)).toBe(409);
    expect(await status("PUT", `/api/projects/${offId}/judge`, { rubric: "x" })).toBe(409);
    expect(await status("GET", `/api/projects/9999/judge`)).toBe(404);
    expect(await status("GET", `/api/eval-runs/9999/judge-options`)).toBe(404);
  });

  it("orders judge models by family and warns when all are the same family", async () => {
    const add = (model: string) => call("POST", `/api/projects/${projectId}/models`, { provider_id: prov, model, for_test: false, for_judge: true });
    const claudeJudge = (await add("claude-judge")).id;
    await add("gpt-judge");
    const url = `/api/eval-runs/${runId}/judge-options`;
    const r = await call("GET", url);
    expect(r.models.map((m: any) => [m.model, m.family, m.same_family])).toEqual([["gpt-judge", "openai", false], ["claude-judge", "claude", true]]);
    expect(r.models[0]).toMatchObject({ provider_id: prov, provider_name: "A", price_status: "missing" });
    expect(r.warning).toBeNull();
    // The tested model is for_test only, so it is not offered as a judge.
    expect(r.models.some((m: any) => m.model === "claude-tested")).toBe(false);
    await call("DELETE", `/api/eval-models/${(r.models[0] as any).id}`);
    const w = await call("GET", url);
    expect(w.models.map((m: any) => m.id)).toEqual([claudeJudge]);
    expect(w.warning).toContain("same family");
  });
});
