import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";

describe("scan reader settings", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!();
  });

  async function app() {
    const data = mkdtempSync(join(tmpdir(), "ad-scan-"));
    const ctx = await buildApp({ dataDir: data });
    cleanup.push(async () => {
      await ctx.app.close();
      rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await ctx.app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
      return { status: r.statusCode, body: r.json() as Record<string, unknown> };
    };
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.body.id, default_model: "m" });
    return { call, providerId: prov.body.id as number };
  }

  it("defaults to no agent and 10 pages", async () => {
    const { call } = await app();
    const s = (await call("GET", "/api/settings")).body;
    expect(s.scan_reader_agent_id).toBe("");
    expect(s.scan_reader_max_pages).toBe("10");
  });

  it("stores an agent only when it exists", async () => {
    const { call, providerId } = await app();
    expect((await call("PUT", "/api/settings", { scan_reader_agent_id: "999999" })).body.scan_reader_agent_id).toBe("");
    const agent = await call("POST", "/api/agents", { name: "Eye", role: "worker", provider_id: providerId });
    expect((await call("PUT", "/api/settings", { scan_reader_agent_id: String(agent.body.id) })).body.scan_reader_agent_id).toBe(String(agent.body.id));
  });

  it("keeps the max pages within 1 to 50 and a whole number", async () => {
    const { call } = await app();
    const pages = async (v: string) => (await call("PUT", "/api/settings", { scan_reader_max_pages: v })).body.scan_reader_max_pages;
    expect(await pages("0")).toBe("1");
    expect(await pages("500")).toBe("50");
    expect(await pages("abc")).toBe("10");
    expect(await pages("7.4")).toBe("7");
  });
});
