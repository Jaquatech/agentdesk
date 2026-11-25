import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0.01, tokensIn: 100, cacheRead: 0, cacheWrite: 0, tokensOut: 10, seconds: 0 });

async function waitFor<T>(fn: () => T | undefined, ms = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("busy developer", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string;
  let script: (req: EngineRequest) => EngineResult;
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo });

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    repo = mkdtempSync(join(tmpdir(), "ad-proj-"));
    g("init", "-q", "-b", "main"); // no commit yet
    engineOverride.engine = { run: async (req) => script(req) };
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } });
      return r.json();
    };
    (ctx as any).call = call;
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    for (const [name, role] of [["Ada", "planner"], ["Bo", "worker"], ["Cy", "reviewer"]]) {
      await call("POST", "/api/agents", { name, role, provider_id: prov.id });
    }
    await call("PUT", "/api/settings", { max_review_rounds: "2", push_and_pr: "false" });
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  async function startChat() {
    const call = (ctx as any).call;
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo, verify: "" });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    script = (req) => {
      if (req.agent.role === "planner") {
        return ok("plan", { reply: "Adding hello.", tasks: [{ slug: "Add Hello", title: "Add hello", spec: "Create src/hello.txt", paths: ["src/"] }] });
      }
      throw new Error("unexpected");
    };
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "please add hello" });
    const task = await waitFor(() => ctx.db.prepare("SELECT * FROM tasks WHERE chat_id = ?").get(chat.id) as any);
    return { call, chat, task };
  }

  it("task fails in ensureWorktree, then retry starts without a restart", async () => {
    const { call, task } = await startChat();
    script = (req) => {
      if (req.agent.role === "worker") {
        mkdirSync(join(req.cwd, "src"), { recursive: true });
        writeFileSync(join(req.cwd, "src", "hello.txt"), "hello\n");
        return ok("Added hello");
      }
      return ok("r", { verdict: "approve", review: "Good" });
    };
    await call("POST", `/api/messages/${task.message_id}/run`);
    const failed = await waitFor(() => {
      const t = ctx.orch.task(task.id);
      return ["failed", "needs_attention"].includes(t.status) ? t : undefined;
    });
    expect(failed.error).toContain("The base branch `main` has no commits. Make an initial commit, then retry.");
    // The developer is free again.
    await waitFor(() => ((ctx.orch as any).busyAgents.size === 0 ? true : undefined));

    writeFileSync(join(repo, "README.md"), "# demo\n");
    g("add", "-A");
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
    ctx.orch.retry(task.id);
    const done = await waitFor(() => {
      const t = ctx.orch.task(task.id);
      return ["approved", "failed", "needs_attention"].includes(t.status) ? t : undefined;
    });
    expect(done.error).toBe("");
    expect(done.status).toBe("approved");
  });

  it("says once that a task waits for a busy developer", async () => {
    const { task } = await startChat();
    const bo = ctx.db.prepare("SELECT id FROM agents WHERE name = 'Bo'").get() as { id: number };
    (ctx.orch as any).busyAgents.add(bo.id);
    ctx.db.prepare("UPDATE tasks SET status = 'queued', worker_id = ? WHERE id = ?").run(bo.id, task.id);
    ctx.orch.tick();
    ctx.orch.tick();
    ctx.orch.tick();
    const waiting = ctx.db.prepare("SELECT id FROM messages WHERE chat_id = ? AND content = 'Waiting for Bo'").all(task.chat_id);
    expect(waiting.length).toBe(1);
  });
});
