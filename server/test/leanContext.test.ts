import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import { DemoEngine } from "../src/engines/demo.ts";
import { applyWikiWrites, projectWikiContext, readWikiPage, searchWikiPages, WIKI_READ_CAP } from "../src/documents.ts";
import { seedDemo } from "../src/demoSeed.ts";
import { runTool } from "../src/engines/tools.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0, tokensIn: 100, cacheRead: 20, cacheWrite: 0, tokensOut: 10, seconds: 0 });

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-lean-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

async function waitFor<T>(fn: () => T | undefined, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe("lean context", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    engineOverride.engine = undefined;
    while (cleanup.length) await cleanup.pop()!();
  });

  async function app() {
    const data = mkdtempSync(join(tmpdir(), "ad-lean-data-"));
    const repo = gitRepo();
    const ctx = await buildApp({ dataDir: data });
    cleanup.push(async () => {
      await ctx.app.close();
      rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await ctx.app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
      return { status: r.statusCode, body: r.json() as Record<string, unknown> };
    };
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.body.id, default_model: "m" });
    for (const [name, role] of [["Ada", "planner"], ["Bo", "worker"], ["Cy", "reviewer"]]) {
      await call("POST", "/api/agents", { name, role, provider_id: prov.body.id });
    }
    return { ctx, repo, call };
  }

  function fill(ctx: Awaited<ReturnType<typeof buildApp>>, chatId: number, n: number) {
    const ins = ctx.db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)");
    for (let i = 1; i <= n; i++) ins.run(chatId, i % 2 ? "user" : "assistant", i === 1 ? "EARLY-MARKER the first note" : `filler turn ${i}`);
  }

  it("clamps the history window and a 40-message chat sends only that window", async () => {
    const { ctx, repo, call } = await app();
    const settings = await call("GET", "/api/settings");
    expect(settings.body.chat_history_messages).toBe("16");
    expect((await call("PUT", "/api/settings", { chat_history_messages: "3" })).body.chat_history_messages).toBe("6");
    expect((await call("PUT", "/api/settings", { chat_history_messages: "100" })).body.chat_history_messages).toBe("40");
    expect((await call("PUT", "/api/settings", { chat_history_messages: "6" })).body.chat_history_messages).toBe("6");

    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.body.id });
    fill(ctx, chat.body.id as number, 39);
    const prompts: string[] = [];
    engineOverride.engine = { run: async (req) => {
      prompts.push(req.prompt);
      if (req.prompt.startsWith("# Summarize dropped chat messages")) return ok("Kept a decision.\nKept a name.\nKept an outcome.");
      return ok("plan", { reply: "Noted.", tasks: [] });
    }};
    await call("POST", `/api/chats/${chat.body.id}/messages`, { content: "LATEST-MARKER the question" });
    await waitFor(() => ctx.db.prepare("SELECT id FROM messages WHERE chat_id = ? AND content = 'Noted.'").get(chat.body.id) as { id: number } | undefined);
    const plan = prompts.find((p) => p.includes("# Conversation"))!;
    expect(plan).toContain("LATEST-MARKER");
    expect(plan).not.toContain("EARLY-MARKER");
    expect(plan.match(/^## (?:User|You \(earlier\))/gm)).toHaveLength(6);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM project_journal WHERE chat_id = ? AND text LIKE 'Earlier in this chat:%'").get(chat.body.id)).toEqual({ n: 1 });

    await call("POST", `/api/chats/${chat.body.id}/messages`, { content: "one more, still inside the slide" });
    await waitFor(() => (ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant'").get(chat.body.id) as { n: number }).n >= 2 ? true : undefined);
    expect(prompts.filter((p) => p.startsWith("# Summarize dropped chat messages"))).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM project_journal WHERE chat_id = ? AND text LIKE 'Earlier in this chat:%'").get(chat.body.id)).toEqual({ n: 1 });
  });

  it("a scrum chat uses the same window", async () => {
    const { ctx, repo, call } = await app();
    await call("PUT", "/api/settings", { chat_history_messages: "6" });
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo, process: "scrum" });
    const chat = await call("POST", "/api/chats", { project_id: project.body.id });
    fill(ctx, chat.body.id as number, 19);
    let prompt = "";
    engineOverride.engine = { run: async (req) => {
      if (req.prompt.startsWith("# Summarize dropped chat messages")) return ok("One.\nTwo.\nThree.");
      prompt = req.prompt;
      return ok("pm", { reply: "Noted.", items: [] });
    }};
    await call("POST", `/api/chats/${chat.body.id}/messages`, { content: "LATEST-OWNER hello" });
    await waitFor(() => ctx.db.prepare("SELECT id FROM messages WHERE chat_id = ? AND content = 'Noted.'").get(chat.body.id) as { id: number } | undefined);
    expect(prompt).toContain("LATEST-OWNER");
    expect(prompt).not.toContain("EARLY-MARKER");
    expect(prompt.match(/^## (?:Business owner|You \(earlier\))/gm)).toHaveLength(6);
    expect(prompt).toMatch(/Project journal/);
  });

  it("the demo planner reads an old decision from the wiki, and the prompt stays inside the window", async () => {
    const { ctx, repo, call } = await app();
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const id = project.body.id as number;
    await call("POST", "/api/documents", { title: "Ship on Fridays", body: "Ship day.\nFriday is the release day, and only then.", project_id: id, section: "decisions" });
    const chat = await call("POST", "/api/chats", { project_id: id });
    fill(ctx, chat.body.id as number, 39);
    const demo = new DemoEngine();
    const seen: { system: string; prompt: string }[] = [];
    engineOverride.engine = { run: async (req: EngineRequest) => {
      seen.push({ system: req.system, prompt: req.prompt });
      if (req.prompt.startsWith("# Summarize dropped chat messages")) return demo.run(req);
      const ask = ([...req.prompt.matchAll(/## (?:User|Business owner)\n([^\n]*)/g)].at(-1)?.[1] ?? "");
      if (/\b(decide|decision|wiki|look up|lookup)\b/i.test(ask)) {
        const result = await demo.run(req);
        expect(result.transcript?.some((e) => e.tool === "read_wiki" && String(e.output).includes("only then"))).toBe(true);
        expect(result.transcript?.some((e) => e.tool === "search_wiki")).toBe(true);
        return result;
      }
      return ok("plan", { reply: "Noted.", tasks: [] });
    }};
    await call("POST", `/api/chats/${chat.body.id}/messages`, { content: "What did we decide about Friday? Please look it up in the wiki." });
    const reply = await waitFor(() => ctx.db.prepare("SELECT content FROM messages WHERE chat_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(chat.body.id) as { content: string } | undefined);
    expect(reply.content).toMatch(/only then/);
    const plan = seen.find((s) => s.prompt.includes("# Conversation"))!;
    expect(plan.prompt).not.toContain("EARLY-MARKER");
    expect(plan.prompt).not.toContain("only then");
    expect(plan.prompt.match(/^## (?:User|You \(earlier\))/gm)).toHaveLength(16);
    expect(plan.system).toMatch(/# Project wiki/);
    expect(plan.system).toMatch(/Ship day/);
    expect(plan.system).not.toMatch(/only then/);
    expect(plan.system.length).toBeLessThan(24_000);
    expect(seen.filter((s) => s.prompt.startsWith("# Summarize dropped chat messages"))).toHaveLength(1);

    await call("POST", `/api/chats/${chat.body.id}/messages`, { content: "thanks, that is all" });
    await waitFor(() => (ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant'").get(chat.body.id) as { n: number }).n >= 2 ? true : undefined);
    expect(seen.filter((s) => s.prompt.startsWith("# Summarize dropped chat messages"))).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM project_journal WHERE chat_id = ? AND text LIKE 'Earlier in this chat:%'").get(chat.body.id)).toEqual({ n: 1 });

    const usage = (await call("GET", `/api/chats/${chat.body.id}`)).body.usage as { tokens: number; last_prompt_chars: number };
    expect(usage.tokens).toBeGreaterThan(0);
    expect(usage.last_prompt_chars).toBeGreaterThan(100);
    expect(usage.last_prompt_chars).toBeLessThan(24_000);
  });

  it("read_wiki and search_wiki return the page, and a general page can be read but not written", async () => {
    const { ctx, repo, call } = await app();
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const id = project.body.id as number;
    ctx.db.prepare("UPDATE documents SET body = ? WHERE project_id = ? AND slot = 'architecture'").run("ARCH-LINE\nARCH-DEEP stays for the architect.", id);
    ctx.db.prepare("UPDATE documents SET body = ? WHERE project_id = ? AND slot = 'overview'").run("Overview line.\nOVERVIEW-DEEP for the overview page.", id);
    await call("POST", "/api/documents", { title: "Ship on Fridays", body: "Ship day.\nFriday is the release day.", project_id: id, section: "decisions" });
    await call("POST", "/api/documents", { title: "Long note", body: "Long line.\n" + "z".repeat(25_000) + "\nLONG-MARKER", project_id: id, section: "decisions" });

    const index = projectWikiContext(ctx.db, id);
    expect(index).toMatch(/ARCH-LINE/);
    expect(index).not.toMatch(/ARCH-DEEP/);
    expect(index).not.toMatch(/LONG-MARKER/);
    expect(index.length).toBeLessThan(24_000);
    const bodies = (ctx.db.prepare("SELECT COALESCE(SUM(LENGTH(body)), 0) AS n FROM documents WHERE project_id = ? OR project_id IS NULL").get(id) as { n: number }).n;
    expect(bodies).toBeGreaterThan(24_000);
    expect(projectWikiContext(ctx.db, id, "job")).toMatch(/ARCH-DEEP/);
    expect(projectWikiContext(ctx.db, id, "job")).toMatch(/OVERVIEW-DEEP/);
    const claude = projectWikiContext(ctx.db, id, "claude");
    expect(claude).toMatch(/no read_wiki tool/);
    expect(claude).toMatch(/OVERVIEW-DEEP/);
    expect(claude).not.toMatch(/ARCH-DEEP/);

    const page = readWikiPage(ctx.db, id, { title: "Ship on Fridays" });
    expect(page).toMatch(/Friday is the release day/);
    const found = searchWikiPages(ctx.db, id, "What did we decide about Friday?");
    expect(found).toMatch(/Ship on Fridays/);
    expect(found).toMatch(/Ship day/);

    const guide = readWikiPage(ctx.db, id, { title: "Coding guidelines" });
    expect(guide).toMatch(/General/);
    expect(guide).toMatch(/Every behaviour change has a check/);
    const refused = applyWikiWrites(ctx.db, id, [{ title: "Coding guidelines", section: "generic", body: "LEAK the project" }]);
    expect(refused.map((w) => w.result).join(" ")).toMatch(/general page/);
    expect(readWikiPage(ctx.db, id, { title: "Coding guidelines" })).not.toMatch(/LEAK/);

    ctx.db.prepare("UPDATE documents SET body = ? WHERE project_id = ? AND slot = 'architecture'").run("ARCH-LINE\n" + "x".repeat(WIKI_READ_CAP) + "ARCH-DEEP-CUT", id);
    const cut = await runTool("read_wiki", { section: "architecture" }, {
      cwd: repo, canWrite: false, commandPrefixes: [],
      readWiki: (q) => readWikiPage(ctx.db, id, q),
    });
    expect(cut.content).toMatch(/page cut/);
    expect(cut.content).toMatch(/characters omitted/);
    expect(cut.content).not.toMatch(/ARCH-DEEP-CUT/);
    const denied = await runTool("read_wiki", { title: "Coding guidelines" }, { cwd: repo, canWrite: false, commandPrefixes: [] });
    expect(denied.isError).toBe(true);

    const worker = ctx.db.prepare("SELECT * FROM agents WHERE name = 'Bo'").get() as import("../src/engines/types.ts").AgentRow;
    let job = "", plain = "";
    engineOverride.engine = { run: async (req) => {
      if (req.agent.role === "worker") job = req.system;
      else plain = req.system;
      return ok("x");
    } };
    await ctx.orch.callAgent({ agent: worker, kind: "build", projectId: id, cwd: repo, prompt: "build", mode: "write", wiki: "job" });
    const planner = ctx.db.prepare("SELECT * FROM agents WHERE name = 'Ada'").get() as import("../src/engines/types.ts").AgentRow;
    await ctx.orch.callAgent({ agent: planner, kind: "plan", projectId: id, cwd: repo, prompt: "plan", mode: "read" });
    expect(job).toMatch(/OVERVIEW-DEEP/);
    expect(job).toMatch(/page cut/);
    expect(plain).not.toMatch(/OVERVIEW-DEEP/);
    expect(plain).toMatch(/read_wiki/);
  });

  it("the demo seed's wiki index stays under the old 24000 character cap", async () => {
    const data = mkdtempSync(join(tmpdir(), "ad-lean-demo-"));
    const ctx = await buildApp({ dataDir: data });
    cleanup.push(async () => {
      await ctx.app.close();
      rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    expect(seedDemo(ctx.db, data)).toBe(true);
    const project = ctx.db.prepare("SELECT id FROM projects").get() as { id: number };
    const wiki = projectWikiContext(ctx.db, project.id);
    expect(wiki.length).toBeLessThan(24_000);
    expect(wiki).toMatch(/Airlock door chime/);
    expect(wiki).toMatch(/# Project wiki/);
    expect(wiki).not.toMatch(/Chime when the airlock door opens/);
    expect(wiki).not.toMatch(/The first two gadgets are on Mars/);
    expect(projectWikiContext(ctx.db, project.id, "job")).toMatch(/## Architecture \(architecture\)/);
    expect(projectWikiContext(ctx.db, project.id, "claude")).not.toMatch(/## Architecture \(architecture\)/);
  });
});
