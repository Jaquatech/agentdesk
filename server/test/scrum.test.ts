import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0.01, tokensIn: 100, cacheRead: 0, cacheWrite: 0, tokensOut: 10, seconds: 0 });

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-scrum-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}
const gitOut = (dir: string, ...a: string[]) => execFileSync("git", a, { cwd: dir }).toString();

async function waitFor<T>(fn: () => T | undefined, ms = 20000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("scrum", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  const points: Record<string, number> = { "Add alpha": 5, "Add beta": 5 };
  const seen: string[] = [];

  const script = (req: EngineRequest): EngineResult => {
    const tool = req.output?.name ?? req.agent.role;
    seen.push(tool);
    if (tool === "submit_backlog") {
      return ok("b", { reply: "Added.", items: [
        { title: "Add alpha", story: "As an owner I want alpha", acceptance: "- [ ] alpha exists" },
        { title: "Add beta", story: "As an owner I want beta", acceptance: "- [ ] beta exists" },
      ] });
    }
    if (tool === "submit_architecture") return ok("a", { tech_notes: "Write src/<name>.txt", paths: ["src/"] });
    if (tool === "submit_estimate") {
      const title = /^## (.+)$/m.exec(req.prompt)?.[1] ?? "";
      return ok("e", { points: points[title], reason: "because" });
    }
    if (tool === "submit_notes") return ok("n", { notes: "## Release notes\n- alpha" });
    if (tool === "submit_security_review") return ok("s", { verdict: "pass", report: "Nothing found." });
    if (tool === "submit_review") return ok("r", { verdict: "approve", review: "Good" });
    if (req.agent.role === "worker") {
      const name = /Backlog item #\d+: Add (\w+)/.exec(req.prompt)?.[1] ?? "x";
      mkdirSync(join(req.cwd, "src"), { recursive: true });
      writeFileSync(join(req.cwd, "src", `${name}.txt`), `${name}\n`);
      return ok("Added " + name);
    }
    throw new Error("unexpected " + tool);
  };

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    repo = gitRepo();
    seen.length = 0;
    engineOverride.engine = { run: async (req) => script(req) };
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => (await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    for (const [name, role] of [["Ada", "planner"], ["Bo", "worker"], ["Cy", "reviewer"]]) await call("POST", "/api/agents", { name, role, provider_id: prov.id });
    await call("PUT", "/api/settings", { max_review_rounds: "1", push_and_pr: "false" });
    ctx.orch.start();
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("refines the backlog, plans by capacity, merges into a sprint branch, and releases", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    await call("PUT", `/api/projects/${project.id}/scrum/settings`, { process: "scrum" });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "We need alpha and beta" });

    // PM → architect → developer estimate, by itself, until Ready.
    const items = await waitFor(() => {
      const rows = ctx.db.prepare("SELECT * FROM backlog_items ORDER BY id").all() as any[];
      return rows.length === 2 && rows.every((r) => r.status === "ready") ? rows : undefined;
    });
    expect(items.map((i: any) => [i.title, i.points])).toEqual([["Add alpha", 5], ["Add beta", 5]]);
    expect(items[0].tech_notes).toContain("src/");
    expect(items[0].priority).toBeLessThan(items[1].priority);

    // One developer × 8 points: only the first 5-point item fits; priority is kept.
    const sprint = await call("POST", `/api/projects/${project.id}/sprints`, { name: "First", goal: "alpha" });
    const preview = await call("GET", `/api/projects/${project.id}/scrum/preview`);
    expect(preview.capacity).toBe(8);
    expect(preview.selected).toEqual([items[0].id]);
    // The user flips the priority: beta first.
    await call("PUT", `/api/projects/${project.id}/backlog/order`, { ids: [items[1].id, items[0].id] });
    expect((await call("GET", `/api/projects/${project.id}/scrum/preview`)).selected).toEqual([items[1].id]);
    await call("PUT", `/api/projects/${project.id}/backlog/order`, { ids: [items[0].id, items[1].id] });

    const started = await call("POST", `/api/sprints/${sprint.id}/start`, {});
    expect(started.status).toBe("active");
    expect(started.branch).toBe("sprint/1-first");
    expect(gitOut(repo, "branch", "--list", "sprint/1-first")).toContain("sprint/1-first");

    // QA approves, the task merges into the sprint branch, the sprint completes itself and writes notes.
    const done = await waitFor(() => {
      const s = ctx.db.prepare("SELECT * FROM sprints WHERE id = ?").get(sprint.id) as any;
      return s.status === "done" && s.release_notes ? s : undefined;
    });
    expect(done.release_notes).toContain("Release notes");
    expect(gitOut(repo, "show", "sprint/1-first:src/alpha.txt")).toBe("alpha\n");
    expect(existsSync(join(repo, "src", "alpha.txt"))).toBe(false); // main untouched until Release
    expect(ctx.db.prepare("SELECT status FROM backlog_items WHERE id = ?").get(items[0].id)).toEqual({ status: "done" }); // merged into the sprint branch

    // Optional security review.
    await call("POST", `/api/sprints/${sprint.id}/security`);
    await waitFor(() => (ctx.db.prepare("SELECT security_verdict v FROM sprints WHERE id = ?").get(sprint.id) as any).v || undefined);

    // Release = merge the sprint branch into main.
    const rel = await call("POST", `/api/sprints/${sprint.id}/release`);
    expect(rel.result).toContain("Merged into main");
    expect(readFileSync(join(repo, "src", "alpha.txt"), "utf8")).toBe("alpha\n");
    expect(gitOut(repo, "branch", "--list", "sprint/1-first")).toBe("");
    const after = await call("GET", `/api/projects/${project.id}/scrum`);
    expect(after.sprints[0].status).toBe("released");
    expect(after.items.find((i: any) => i.id === items[0].id).status).toBe("done");
    expect(after.items.find((i: any) => i.id === items[1].id).status).toBe("ready"); // did not fit: still in the backlog

    // Token usage by sprint: every kind of work the sprint needed, refinement included.
    const u = after.sprints[0].usage;
    expect(Object.keys(u.by_kind).sort()).toEqual(["build", "notes", "refine", "review", "security"]);
    expect(u.cost).toBeGreaterThan(0);
    expect(after.unplanned.by_kind.backlog.runs).toBeGreaterThan(0); // the PM's chat answer belongs to no sprint
  });

  it("closing a sprint sends unfinished items back to the backlog", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    await call("PUT", `/api/projects/${project.id}/scrum/settings`, { process: "scrum" });
    const item = await call("POST", `/api/projects/${project.id}/backlog`, { title: "Add alpha", story: "s", acceptance: "a" });
    points["Add alpha"] = 3;
    await waitFor(() => (ctx.db.prepare("SELECT status FROM backlog_items WHERE id = ?").get(item.id) as any).status === "ready" || undefined);
    const sprint = await call("POST", `/api/projects/${project.id}/sprints`, { name: "S" });
    // The developer never finishes: the task needs attention, then the sprint is closed.
    const orig = script;
    engineOverride.engine = { run: async (req) => { if (req.agent.role === "worker") throw new Error("boom"); return orig(req); } };
    await call("POST", `/api/sprints/${sprint.id}/start`, {});
    await waitFor(() => (ctx.db.prepare("SELECT status FROM tasks WHERE item_id = ?").get(item.id) as any).status === "failed" || undefined);
    await call("POST", `/api/sprints/${sprint.id}/close`);
    const row = ctx.db.prepare("SELECT status, sprint_id FROM backlog_items WHERE id = ?").get(item.id) as any;
    expect(row).toEqual({ status: "ready", sprint_id: null });
    expect((ctx.db.prepare("SELECT status FROM sprints WHERE id = ?").get(sprint.id) as any).status).toBe("done");
  });
});
