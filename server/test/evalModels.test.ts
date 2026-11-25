import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { modelFamily } from "../src/dataFactory/modelFamily.ts";

describe("eval models", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number, offId: number;
  let anthropic: number, ollama: number, cli: number;

  const provider = (name: string, kind: string) =>
    Number(ctx.db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES (?, ?, '', 'm')").run(name, kind).lastInsertRowid);

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-em-"));
    repo = mkdtempSync(join(tmpdir(), "ad-em-repo-"));
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
    anthropic = provider("A", "anthropic");
    ollama = provider("O", "ollama");
    cli = provider("C", "claude-cli");
  });

  afterEach(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("adds, lists and deletes a model", async () => {
    const { id } = await call("POST", `/api/projects/${projectId}/models`, { provider_id: ollama, model: " llama3 ", note: "x" });
    const list = await call("GET", `/api/projects/${projectId}/models`);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, model: "llama3", family: "llama", for_test: 1, for_judge: 0, provider_name: "O", note: "x" });
    expect(await status("PUT", `/api/eval-models/${id}`, { for_test: false, for_judge: true, note: "j" })).toBe(200);
    expect((await call("GET", `/api/projects/${projectId}/models`))[0]).toMatchObject({ for_test: 0, for_judge: 1, note: "j" });
    expect(await status("PUT", `/api/eval-models/${id}`, { for_test: false, for_judge: false, note: "" })).toBe(400);
    expect(await status("DELETE", `/api/eval-models/${id}`)).toBe(200);
    expect(await call("GET", `/api/projects/${projectId}/models`)).toEqual([]);
  });

  it("refuses bad input and duplicates", async () => {
    const url = `/api/projects/${projectId}/models`;
    expect(await status("POST", url, { provider_id: ollama, model: "  " })).toBe(400);
    expect(await status("POST", url, { provider_id: cli, model: "x" })).toBe(400);
    expect(await status("POST", url, { provider_id: ollama, model: "x", for_test: false })).toBe(400);
    expect(await status("POST", url, { provider_id: 9999, model: "x" })).toBe(400);
    expect(await status("POST", url, { provider_id: ollama, model: "x" })).toBe(200);
    expect(await status("POST", url, { provider_id: ollama, model: "x" })).toBe(409);
  });

  it("refuses every route when the Data factory is off", async () => {
    const { id } = await call("POST", `/api/projects/${projectId}/models`, { provider_id: ollama, model: "x" });
    ctx.db.prepare("UPDATE projects SET data_factory = 0 WHERE id = ?").run(projectId);
    expect(await status("GET", `/api/projects/${projectId}/models`)).toBe(409);
    expect(await status("POST", `/api/projects/${projectId}/models`, { provider_id: ollama, model: "y" })).toBe(409);
    expect(await status("PUT", `/api/eval-models/${id}`, { for_test: true, for_judge: false, note: "" })).toBe(409);
    expect(await status("DELETE", `/api/eval-models/${id}`)).toBe(409);
    expect(await status("GET", `/api/projects/${offId}/models`)).toBe(409);
  });

  it("reports price status: priced, free, missing", async () => {
    ctx.db.prepare("INSERT INTO model_prices (model, price_in, price_out, cache_read, cache_write, long_threshold, long_multiplier, note) VALUES ('priced-m', 1, 2, 0.1, 1.5, 0, 1, '')").run();
    const url = `/api/projects/${projectId}/models`;
    await call("POST", url, { provider_id: anthropic, model: "priced-m" });
    await call("POST", url, { provider_id: ollama, model: "local-m" });
    await call("POST", url, { provider_id: anthropic, model: "unpriced-m" });
    const by = Object.fromEntries((await call("GET", url)).map((r: any) => [r.model, r]));
    expect(by["priced-m"]).toMatchObject({ price_status: "priced", price_in: 1, price_out: 2, cache_read: 0.1, cache_write: 1.5 });
    expect(by["local-m"]).toMatchObject({ price_status: "free", price_in: null });
    expect(by["unpriced-m"]).toMatchObject({ price_status: "missing", price_in: null });
  });

  it("finds the family", () => {
    expect(modelFamily("claude-sonnet-5-5")).toBe("claude");
    expect(modelFamily("gpt-4o")).toBe("openai");
    expect(modelFamily("o3-mini")).toBe("openai");
    expect(modelFamily("meta/llama-3.1-8b")).toBe("llama");
    expect(modelFamily("qwen2.5-coder")).toBe("qwen");
    expect(modelFamily("demo-model")).toBe("demo");
    expect(modelFamily("orca-2")).toBe("unknown");
  });
});
