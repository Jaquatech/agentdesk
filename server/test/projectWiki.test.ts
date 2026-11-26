import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { ApiLoopEngine } from "../src/engines/apiLoop.ts";
import { engineOverride } from "../src/providers/index.ts";
import type { ChatProvider, ChatRequest } from "../src/providers/types.ts";
import type { AgentRow, EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0, tokensIn: 10, cacheRead: 0, cacheWrite: 0, tokensOut: 5, seconds: 0 });

const UPDATE_SENTENCE = "You may update this project's wiki pages";
const WORD = "zanzibarquokka";

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-pw-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

async function waitFor<T>(fn: () => T | undefined, ms = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("project wiki switch", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<Record<string, unknown>>;
  let id: number;
  const seen: EngineRequest[] = [];

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-pw-data-"));
    repo = gitRepo();
    seen.length = 0;
    engineOverride.engine = { run: async (req) => { seen.push(req); return ok("done"); } };
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => {
      const r = await ctx.app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
      return r.json() as Record<string, unknown>;
    };
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    for (const [name, role] of [["Ada", "planner"], ["Bo", "worker"], ["Cy", "reviewer"]]) {
      await call("POST", "/api/agents", { name, role, provider_id: prov.id });
    }
    id = (await call("POST", "/api/projects", { name: "demo", source: "local", path: repo })).id as number;
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const flag = () => (ctx.db.prepare("SELECT project_wiki AS v FROM projects WHERE id = ?").get(id) as { v: number }).v;
  const agent = () => ctx.db.prepare("SELECT * FROM agents WHERE name = 'Cy'").get() as AgentRow;
  const slot = (name: string) => (ctx.db.prepare("SELECT body FROM documents WHERE project_id = ? AND slot = ?").get(id, name) as { body: string }).body;
  const review = (prompt = "review") => ctx.orch.callAgent({ agent: agent(), kind: "review", projectId: id, cwd: repo, prompt, mode: "read" });
  const put = (project_wiki?: number) => call("PUT", `/api/projects/${id}`, { name: "demo", source: "local", path: repo, ...(project_wiki === undefined ? {} : { project_wiki }) });

  it("stores the switch: on by default, 0 is off, absent keeps it, any other value is on", async () => {
    expect(flag()).toBe(1);
    await put(0);
    expect(flag()).toBe(0);
    await put();
    expect(flag()).toBe(0);
    await put(7);
    expect(flag()).toBe(1);
  });

  it("on: the system text has the Overview line and writeWiki is a function", async () => {
    await review();
    const overview = ctx.db.prepare("SELECT title FROM documents WHERE project_id = ? AND slot = 'overview'").get(id) as { title: string };
    expect(seen[0].system).toContain(`- ${overview.title} (`);
    expect(seen[0].writeWiki).toBeTypeOf("function");
  });

  it("off: no project page text, no writes, General pages still readable", async () => {
    ctx.db.prepare("UPDATE documents SET body = ? WHERE project_id = ? AND slot IN ('overview', 'architecture')").run(`Secret ${WORD} text`, id);
    await put(0);
    await review();
    const req = seen[0];
    expect(req.system).not.toContain(WORD);
    expect(req.prompt).not.toContain(WORD);
    expect(req.system).toContain("The project wiki is off for this project. Only General pages can be read.");
    expect(req.system).toContain("# General pages");
    expect(req.writeWiki).toBeUndefined();
    expect(req.readWiki!({ section: "overview" })).not.toContain(WORD);
    expect(req.searchWiki!(WORD)).not.toContain(WORD);
    const general = ctx.db.prepare("SELECT title FROM documents WHERE project_id IS NULL AND builtin = 'guidelines'").get() as { title: string };
    expect(req.searchWiki!(general.title.split(/\s+/)[0])).toContain(general.title);
    expect(req.readWiki!({ title: general.title })).toContain(general.title);
  });

  it("off: the planner and a Scrum call lose the update sentence and the wiki field; on again brings them back", async () => {
    const chat = await call("POST", "/api/chats", { project_id: id });
    const ask = async (text: string) => {
      const before = seen.length;
      await call("POST", `/api/chats/${chat.id}/messages`, { content: text });
      await waitFor(() => (seen.length > before ? true : undefined));
      return seen[seen.length - 1];
    };
    engineOverride.engine = { run: async (req) => { seen.push(req); return ok("plan", { reply: "Fine.", tasks: [], items: [] }); } };

    await put(0);
    const planOff = await ask("hello");
    expect(planOff.output?.name).toBe("submit_plan");
    expect(planOff.prompt).not.toContain(UPDATE_SENTENCE);
    expect(JSON.stringify(planOff.output?.input_schema)).not.toContain('"wiki"');
    await waitFor(() => (ctx.orch.isPlanning(Number(chat.id)) ? undefined : true));

    await put(1);
    const planOn = await ask("hello again");
    expect(planOn.prompt).toContain(UPDATE_SENTENCE);
    expect(JSON.stringify(planOn.output?.input_schema)).toContain('"wiki"');
    await waitFor(() => (ctx.orch.isPlanning(Number(chat.id)) ? undefined : true));

    await call("PUT", `/api/projects/${id}/scrum/settings`, { process: "scrum" });
    await put(0);
    const scrumChat = await call("POST", "/api/chats", { project_id: id });
    const before = seen.length;
    await call("POST", `/api/chats/${scrumChat.id}/messages`, { content: "backlog please" });
    await waitFor(() => (seen.length > before ? true : undefined));
    const scrumOff = seen[seen.length - 1];
    expect(scrumOff.output?.name).toBe("submit_backlog");
    expect(scrumOff.prompt).not.toContain(UPDATE_SENTENCE);
    expect(JSON.stringify(scrumOff.output?.input_schema)).not.toContain('"wiki"');
    await waitFor(() => (ctx.orch.isPlanning(Number(scrumChat.id)) ? undefined : true));

    await put(1);
    const again = seen.length;
    await call("POST", `/api/chats/${scrumChat.id}/messages`, { content: "backlog again" });
    await waitFor(() => (seen.length > again ? true : undefined));
    const scrumOn = seen[seen.length - 1];
    expect(scrumOn.prompt).toContain(UPDATE_SENTENCE);
    expect(JSON.stringify(scrumOn.output?.input_schema)).toContain('"wiki"');
  });

  it("off: a wiki array in the result writes nothing and leaves no wiki note", async () => {
    await put(0);
    const before = slot("setup");
    engineOverride.engine = { run: async () => ok("done", { verdict: "approve", review: "ok", wiki: [{ section: "setup", body: "Changed anyway." }] }) };
    await review();
    expect(slot("setup")).toBe(before);
    const run = ctx.db.prepare("SELECT log, transcript FROM runs WHERE kind = 'review'").get() as { log: string; transcript: string | null };
    expect(run.log).not.toContain("wiki:");
    expect(run.transcript ?? "").not.toContain("wiki");
  });
});

describe("api loop wiki tools", () => {
  it("offers read_wiki and search_wiki without write_wiki when only the read functions are given", async () => {
    const requests: ChatRequest[] = [];
    const chat: ChatProvider = {
      async chat(req) {
        requests.push(req);
        return { content: [{ type: "tool_use", id: "1", name: "finish", input: { summary: "done" } }], stopReason: "tool_use", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
      },
      async listModels() { return []; },
    };
    const row: AgentRow = {
      id: 1, name: "T", role: "reviewer", provider_id: 1, model: "m", context: "", max_turns: 5, timeout_min: 5,
      allowed_tools: "[]", appearance: "{}", enabled: 1,
    };
    await new ApiLoopEngine().run({
      agent: row, cwd: tmpdir(), system: "sys", prompt: "go", mode: "read",
      readWiki: () => "page", searchWiki: () => "hits",
      provider: { id: 1, name: "p", baseUrl: "", kind: "anthropic", model: "m", chat,
        price: { model: "m", price_in: 0, price_out: 0, cache_read: 0, cache_write: 0, long_threshold: 0, long_multiplier: 1, note: "" } },
    });
    const names = requests[0].tools!.map((t) => t.name);
    expect(names).toContain("read_wiki");
    expect(names).toContain("search_wiki");
    expect(names).not.toContain("write_wiki");
  });
});
