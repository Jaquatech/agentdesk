import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { applyWikiWrites } from "../src/documents.ts";
import { runTool } from "../src/engines/tools.ts";
import { engineOverride } from "../src/providers/index.ts";
import { demoLiveWiki } from "../src/engines/demo.ts";
import { buildWorkerPrompt, ARCHITECT_TOOL, ESTIMATE_TOOL, NOTES_TOOL, REVIEW_TOOL, SCRUM_TOOL, SECURITY_TOOL } from "../src/orchestrator/prompts.ts";
import type { AgentRow, EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0, tokensIn: 10, cacheRead: 0, cacheWrite: 0, tokensOut: 5, seconds: 0 });

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-wiki-"));
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

describe("wiki writes", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<Record<string, unknown>>;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-wiki-data-"));
    repo = gitRepo();
    engineOverride.engine = { run: async () => ok("unused") };
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
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  function slot(projectId: number, name: string) {
    return (ctx.db.prepare("SELECT body FROM documents WHERE project_id = ? AND slot = ?").get(projectId, name) as { body: string }).body;
  }

  it("normalizes sections, allows a slot with no title, and reports a refusal", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const id = project.id as number;
    const guideBefore = (ctx.db.prepare("SELECT body FROM documents WHERE builtin = 'guidelines'").get() as { body: string }).body;
    const wrote = applyWikiWrites(ctx.db, id, [
      { section: "Road map", body: "Ship the alarm." },
      { section: "road-map", body: "Ship the alarm next." },
      { section: "Overview.md", body: "A local tool." },
      { section: "setup", body: "Run it from the project folder." },
      { title: "Architecture", section: "notes", body: "One database." },
      { section: "sideways", title: "Notes", body: "nope" },
      { title: "Coding guidelines", section: "generic", body: "LEAK the project" },
      { section: "overview", body: "   " },
      { section: "decisions", body: "No title." },
    ]);
    expect(wrote.map((w) => w.result)).toEqual([
      "updated",
      "updated",
      "updated",
      "updated",
      "updated",
      'unknown section "sideways"',
      'general page "Coding guidelines"',
      "empty body",
      "missing title",
    ]);
    expect(slot(id, "roadmap")).toBe("Ship the alarm next.");
    expect(slot(id, "overview")).toBe("A local tool.");
    expect(slot(id, "setup")).toBe("Run it from the project folder.");
    expect(slot(id, "architecture")).toBe("One database.");
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE project_id = ? AND title = 'Notes'").get(id)).toEqual({ n: 0 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE project_id = ? AND section = 'decisions'").get(id)).toEqual({ n: 0 });
    const guide = ctx.db.prepare("SELECT body FROM documents WHERE builtin = 'guidelines'").get() as { body: string };
    expect(guide.body).toBe(guideBefore);
    expect(guide.body).not.toMatch(/LEAK/);

    const tool = await runTool("write_wiki", { section: "setup", body: "From a reviewer." }, {
      cwd: repo, canWrite: false, commandPrefixes: [],
      writeWiki: (p) => applyWikiWrites(ctx.db, id, [p]).map((r) => r.result).join("\n"),
    });
    expect(tool.isError).toBeFalsy();
    expect(tool.content).toBe("updated");
    expect(slot(id, "setup")).toBe("From a reviewer.");
  });

  it("gives a read-mode call writeWiki when a project is known, even with no team", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const id = project.id as number;
    const seen: EngineRequest[] = [];
    engineOverride.engine = { run: async (req) => {
      seen.push(req);
      if (req.writeWiki) expect(req.writeWiki({ section: "Overview.md", body: "From a reviewer." })).toBe("updated");
      return ok("done", req.writeWiki ? { wiki: [{ section: "setup", body: "Run from the project folder." }] } : undefined);
    }};
    const agent = ctx.db.prepare("SELECT * FROM agents WHERE name = 'Cy'").get() as AgentRow;
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM team_members").get()).toEqual({ n: 0 });
    await ctx.orch.callAgent({ agent, kind: "review", projectId: id, cwd: repo, prompt: "review", mode: "read" });
    expect(seen[0].mode).toBe("read");
    expect(seen[0].writeWiki).toBeTypeOf("function");
    expect(slot(id, "overview")).toBe("From a reviewer.");
    expect(slot(id, "setup")).toBe("Run from the project folder.");
    const run = ctx.db.prepare("SELECT log, transcript FROM runs WHERE kind = 'review'").get() as { log: string; transcript: string };
    expect(run.log).toContain("wiki: updated");
    expect(run.transcript).toContain("updated");

    await ctx.orch.callAgent({ agent, kind: "notes", cwd: repo, prompt: "no project", mode: "read" });
    expect(seen[1].writeWiki).toBeUndefined();
  });

  it("applies the planner wiki field in a normal chat and in Scrum chat", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const id = project.id as number;
    engineOverride.engine = { run: async () => ok("plan", {
      reply: "Noted.", tasks: [],
      wiki: [{ section: "architecture", body: "One process, one database." }],
    }) };
    const chat = await call("POST", "/api/chats", { project_id: id });
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "describe the architecture" });
    await waitFor(() => slot(id, "architecture").includes("One process") ? true : undefined);
    expect(slot(id, "architecture")).toBe("One process, one database.");

    await call("PUT", `/api/projects/${id}/scrum/settings`, { process: "scrum" });
    engineOverride.engine = { run: async (req) => {
      expect(req.output?.name).toBe("submit_backlog");
      expect(req.mode).toBe("read");
      expect(req.writeWiki).toBeTypeOf("function");
      return ok("backlog", {
        reply: "Added nothing.", items: [],
        wiki: [{ section: "Road map", body: "The product manager recorded the road map." }],
      });
    }};
    const scrumChat = await call("POST", "/api/chats", { project_id: id });
    await call("POST", `/api/chats/${scrumChat.id}/messages`, { content: "review the backlog" });
    await waitFor(() => slot(id, "roadmap").includes("product manager") ? true : undefined);
    expect(slot(id, "roadmap")).toBe("The product manager recorded the road map.");
    const log = ctx.db.prepare("SELECT log FROM runs WHERE kind = 'backlog' ORDER BY id DESC LIMIT 1").get() as { log: string };
    expect(log.log).toContain("wiki: updated");
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM backlog_items").get()).toEqual({ n: 0 });
  });
});

describe("wiki instructions", () => {
  it("names the six sections for every role, and the demo writes Overview on the live task only", () => {
    const worker = buildWorkerPrompt({ title: "Alarm", spec: "Add it.", branch: "task/alarm", round: 0, paths: ["demo/"], verify: [] });
    expect(worker).toMatch(/write_wiki/);
    expect(worker).toMatch(/Road map/);
    for (const tool of [SCRUM_TOOL, ARCHITECT_TOOL, ESTIMATE_TOOL, NOTES_TOOL, REVIEW_TOOL, SECURITY_TOOL]) {
      expect(JSON.stringify(tool.input_schema)).toContain("wiki");
    }
    const live = "# Task: Dust Buddy: airlock dust alarm\n\nAdd the alarm.";
    expect(demoLiveWiki(live)?.section).toBe("overview");
    expect(demoLiveWiki(live)?.body).toMatch(/airlock dust alarm/);
    expect(demoLiveWiki("# Review: Dust Buddy: airlock dust alarm\n")).toBeUndefined();
    expect(demoLiveWiki("# Task: Cocoa Printer: marshmallow mode\n")).toBeUndefined();
    expect(demoLiveWiki("# Task: Dust Buddy: airlock dust alarm\n\n# Round 2: fix\n")).toBeUndefined();
  });
});
