import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";

describe("spending limits", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>, calls = 0;
  let call: (m: string, u: string, p?: unknown) => Promise<any>;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    repo = mkdtempSync(join(tmpdir(), "ad-bud-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "a");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "i"], { cwd: repo });
    calls = 0;
    engineOverride.engine = { run: async () => { calls++; return { ok: true, summary: "x", output: { reply: "hi", tasks: [] }, turns: 1, costUsd: 0.3, tokensIn: 1, cacheRead: 0, cacheWrite: 0, tokensOut: 1, seconds: 0 }; } };
    ctx = await buildApp({ dataDir: data });
    const s = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(s.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => (await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
    const secret = await call("POST", "/api/secrets", { name: "k", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "A", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    await call("POST", "/api/agents", { name: "Ada", role: "planner", provider_id: prov.id });
  });
  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("refuses new agent calls once the daily limit is reached, and resumes when it is raised", async () => {
    const project = await call("POST", "/api/projects", { name: "p", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    await call("PUT", "/api/settings", { budget_day_usd: "0.5" });
    const ask = async (text: string) => {
      await call("POST", `/api/chats/${chat.id}/messages`, { content: text });
      for (let i = 0; i < 100 && ctx.orch.isPlanning(chat.id); i++) await new Promise((r) => setTimeout(r, 30));
      await new Promise((r) => setTimeout(r, 50));
    };
    await ask("one");   // $0.30
    await ask("two");   // $0.60: now over the $0.50 limit
    expect(calls).toBe(2);
    const b = await call("GET", "/api/budget");
    expect(b.day).toMatchObject({ limit: 0.5, over: true, warn: true });
    await ask("three"); // refused: no model call
    expect(calls).toBe(2);
    const msgs = ctx.db.prepare("SELECT content FROM messages WHERE chat_id = ? AND role = 'event'").all(chat.id) as { content: string }[];
    expect(msgs.some((m) => m.content.includes("Budget reached"))).toBe(true);
    await call("PUT", "/api/settings", { budget_day_usd: "0" });
    await ask("four");
    expect(calls).toBe(3);
  });
});
