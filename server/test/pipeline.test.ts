import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0.01, tokensIn: 100, cacheRead: 0, cacheWrite: 0, tokensOut: 10, seconds: 0 });

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-proj-"));
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
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("pipeline", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string;
  let script: (req: EngineRequest) => EngineResult;
  const calls: string[] = [];

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    repo = gitRepo();
    calls.length = 0;
    engineOverride.engine = { run: async (req) => { calls.push(`${req.agent.role}:${req.mode}`); return script(req); } };
    ctx = await buildApp({ dataDir: data });
    const app = ctx.app;
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } });
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
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  async function startChat(verify: string[], paths = ["src/"]) {
    const call = (ctx as any).call;
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo, verify: verify.join("\n") });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    script = (req) => {
      if (req.agent.role === "planner") {
        return ok("plan", { reply: "Adding hello.", tasks: [{ slug: "Add Hello", title: "Add hello", spec: "Create src/hello.txt", paths }] });
      }
      throw new Error("unexpected");
    };
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "please add hello" });
    const task = await waitFor(() => ctx.db.prepare("SELECT * FROM tasks WHERE chat_id = ?").get(chat.id) as any);
    expect(task.status).toBe("proposed");
    expect(task.slug).toBe("add-hello");
    return { call, chat, task };
  }

  it("plans, builds, verifies, reviews with one fix round, and merges locally", async () => {
    const { call, task } = await startChat(["git diff --quiet HEAD"]);
    let reviews = 0;
    script = (req) => {
      if (req.agent.role === "worker") {
        const f = join(req.cwd, "src", "hello.txt");
        execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
        writeFileSync(f, req.prompt.includes("Round 2") ? "hello, world\n" : "hello\n");
        return ok("Added hello");
      }
      reviews++;
      return reviews === 1
        ? ok("r", { verdict: "changes", review: "Say world too", fixes: ["Write 'hello, world'"] })
        : ok("r", { verdict: "approve", review: "Good" });
    };
    await call("POST", `/api/messages/${task.message_id}/run`);
    const done = await waitFor(() => {
      const t = ctx.orch.task(task.id);
      return ["approved", "failed", "needs_attention"].includes(t.status) ? t : undefined;
    });
    expect(done.error).toBe("");
    expect(done.status).toBe("approved");
    expect(done.round).toBe(1);
    expect(calls).toEqual(["planner:read", "worker:write", "reviewer:read", "worker:write", "reviewer:read"]);
    expect(readFileSync(join(done.worktree, "src", "hello.txt"), "utf8")).toBe("hello, world\n");

    const merged = await call("POST", `/api/tasks/${task.id}/merge`);
    expect(merged.result).toContain("Squash-merged into main");
    expect(readFileSync(join(repo, "src", "hello.txt"), "utf8")).toBe("hello, world\n");
    expect(ctx.orch.task(task.id).status).toBe("merged");
    expect(existsSync(done.worktree)).toBe(false);

    const runs = ctx.db.prepare("SELECT kind FROM runs WHERE task_id = ? ORDER BY id").all(task.id).map((r: any) => r.kind);
    expect(runs).toEqual(["build", "checks", "review", "build", "checks", "review"]);

    // Usage: every call counted once, per agent and per day; CSV has a row per call.
    const usage = await call("GET", "/api/usage?days=7");
    expect(usage.totals.runs).toBe(5);
    expect(usage.totals.cost_usd).toBeCloseTo(0.05, 6);
    expect(usage.byAgent.map((a: any) => [a.name, a.runs])).toEqual(expect.arrayContaining([["Ada", 1], ["Bo", 2], ["Cy", 2]]));
    expect(usage.byProject[0].name).toBe("demo");
    const day = usage.daily[0].day;
    const log = await call("GET", `/api/usage/runs?day=${day}`);
    expect(log.map((r: any) => r.kind)).toEqual(["plan", "build", "review", "build", "review"]);
    expect(log[1].task).toBe("Add hello");
    const csv = await ctx.app.inject({ method: "GET", url: "/api/usage/export.csv", headers: { cookie, host: "localhost" } });
    expect(csv.body.trim().split("\r\n")).toHaveLength(6);
  });

  it("refuses a commit with files outside the task paths", async () => {
    const { call, task } = await startChat([]);
    script = (req) => { writeFileSync(join(req.cwd, "README.md"), "changed\n"); return ok("done"); };
    await call("POST", `/api/messages/${task.message_id}/run`);
    const t = await waitFor(() => { const x = ctx.orch.task(task.id); return x.status === "failed" ? x : undefined; });
    expect(t.error).toContain("outside the allowed paths");
    expect(t.error).toContain("README.md");
  });

  it("sends a failed verify back to the worker and stops after the last round", async () => {
    const { call, task } = await startChat(["exit 3"]);
    script = (req) => {
      execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
      writeFileSync(join(req.cwd, "src", `f${Math.random()}.txt`), "x");
      return ok("done");
    };
    await call("POST", `/api/messages/${task.message_id}/run`);
    const t = await waitFor(() => { const x = ctx.orch.task(task.id); return x.status === "needs_attention" ? x : undefined; });
    expect(t.round).toBe(2);
    expect(t.error).toContain("exit 3");
    expect(calls.filter((c) => c.startsWith("worker")).length).toBe(3);

    // Retry = one more fix round, and the developer gets the last failure as its instructions.
    const prompts: string[] = [];
    script = (req) => { prompts.push(req.prompt); writeFileSync(join(req.cwd, "src", `g${Math.random()}.txt`), "x"); return ok("again"); };
    await call("POST", `/api/tasks/${task.id}/retry`, {});
    const t2 = await waitFor(() => { const x = ctx.orch.task(task.id); return x.status === "needs_attention" && x.round === 3 ? x : undefined; });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Round 4: fix");
    expect(prompts[0]).toContain("Verify failed");
    expect(t2.feedback).toContain("exit 3");
  });

  it("stops at once, without a fix round, when a check fails because of the project setup", async () => {
    const { call, task } = await startChat(["echo 'Error: environment variable ATTACHMENTS_ROOT is not set' && exit 1"]);
    script = (req) => {
      execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
      writeFileSync(join(req.cwd, "src", "a.txt"), "x");
      return ok("done");
    };
    await call("POST", `/api/messages/${task.message_id}/run`);
    const t = await waitFor(() => { const x = ctx.orch.task(task.id); return x.status === "needs_attention" ? x : undefined; });
    expect(t.round).toBe(0);
    expect(t.error).toContain("ATTACHMENTS_ROOT");
    expect(t.error).toContain("project setup");
    expect(calls.filter((c) => c.startsWith("worker")).length).toBe(1);
  });

  it("copies the env file for the checks only while they run, and removes it after", async () => {
    const { call, task } = await startChat(["node -e \"process.exit(require('fs').readFileSync('.env.test','utf8').includes('A=1')?0:1)\""]);
    writeFileSync(join(repo, ".env.test"), "A=1\n");
    ctx.db.prepare("UPDATE projects SET checks_env_file = '.env.test'").run();
    let seen = false;
    script = (req) => {
      if (req.agent.role === "worker") {
        seen = seen || existsSync(join(req.cwd, ".env.test"));
        execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
        writeFileSync(join(req.cwd, "src", "b.txt"), "x");
        return ok("done");
      }
      seen = seen || existsSync(join(req.cwd, ".env.test"));
      return ok("r", { verdict: "approve", review: "Good" });
    };
    await call("POST", `/api/messages/${task.message_id}/run`);
    const t = await waitFor(() => { const x = ctx.orch.task(task.id); return ["approved", "failed", "needs_attention"].includes(x.status) ? x : undefined; });
    expect(t.status).toBe("approved");
    expect(seen).toBe(false);
    expect(existsSync(join(t.worktree, ".env.test"))).toBe(false);
  });

  it("rejects an env file name that leaves the project folder", async () => {
    const call = (ctx as any).call;
    const r = await call("POST", "/api/projects", { name: "x", source: "local", path: repo, checks_env_file: "../secret.env" });
    expect(JSON.stringify(r)).toContain("Env file for checks");
  });

  it("lists each verify command with its own result; the failure output is one request away", async () => {
    const { call, task } = await startChat(["echo lint-ok", "exit 3", "echo tests-ok"]);
    const before = await call("GET", `/api/tasks/${task.id}`);
    expect(before.checks.items.map((c: any) => c.status)).toEqual(["not_run", "not_run", "not_run"]);
    script = (req) => {
      execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
      writeFileSync(join(req.cwd, "src", `h${Math.random()}.txt`), "x");
      return ok("done");
    };
    await call("POST", `/api/messages/${task.message_id}/run`);
    await waitFor(() => { const x = ctx.orch.task(task.id); return x.status === "needs_attention" ? x : undefined; });
    const { checks } = await call("GET", `/api/tasks/${task.id}`);
    // The command after the failed one did not run: it is "not_run", never "passed".
    expect(checks.items.map((c: any) => [c.command, c.status, c.exit])).toEqual([
      ["echo lint-ok", "passed", 0], ["exit 3", "failed", 3], ["echo tests-ok", "not_run", null],
    ]);
    expect(JSON.stringify(checks)).not.toContain("lint-ok\n");
    const run = await call("GET", `/api/runs/${checks.run_id}`);
    expect(run.transcript[checks.items[1].step].output).toContain("exit 3");
  });

  it("never returns secret values from the API", async () => {
    const call = (ctx as any).call;
    const list = await call("GET", "/api/secrets");
    expect(JSON.stringify(list)).not.toContain("sk-test-1234567890");
    expect(list[0].hint).toBe("sk-…7890");
    const raw = ctx.db.prepare("SELECT ciphertext FROM secrets").get() as any;
    expect(raw.ciphertext).not.toContain("sk-test");
  });

  it("rejects requests without a session and from other hosts", async () => {
    const r1 = await ctx.app.inject({ method: "GET", url: "/api/agents", headers: { host: "localhost" } });
    expect(r1.statusCode).toBe(401);
    const r2 = await ctx.app.inject({ method: "GET", url: "/api/agents", headers: { host: "evil.example", cookie } });
    expect(r2.statusCode).toBe(403);
    const r3 = await ctx.app.inject({ method: "POST", url: "/api/settings", headers: { host: "localhost", cookie, origin: "https://evil.example" } });
    expect(r3.statusCode).toBe(403);
  });

  it("pushes to a remote, merges from a chat answer, and discard deletes the pushed branch", async () => {
    const call = (ctx as any).call;
    const bare = mkdtempSync(join(tmpdir(), "ad-bare-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    execFileSync("git", ["remote", "add", "origin", bare], { cwd: repo });
    execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd: repo });
    await call("PUT", "/api/settings", { push_and_pr: "true" });
    const project = await call("POST", "/api/projects", { name: "remote", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    let planned = 0;
    script = (req) => {
      if (req.agent.role === "planner") {
        planned++;
        return planned === 1
          ? ok("p", { reply: "two", tasks: [{ slug: "one", title: "One", spec: "x", paths: ["src/"] }, { slug: "two", title: "Two", spec: "y", paths: ["src/"] }] })
          : ok("p", { reply: "merging", tasks: [], merge: ["one", "not-a-task"] });
      }
      if (req.agent.role === "worker") {
        execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
        writeFileSync(join(req.cwd, "src", `${req.prompt.includes("One") ? "one" : "two"}.txt`), "x");
        return ok("done");
      }
      return ok("r", { verdict: "approve", review: "ok" });
    };
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "do two things" });
    const msgId = await waitFor(() => (ctx.db.prepare("SELECT message_id FROM tasks WHERE chat_id = ?").get(chat.id) as any)?.message_id);
    await call("POST", `/api/messages/${msgId}/run`);
    await waitFor(() => (ctx.db.prepare("SELECT COUNT(*) n FROM tasks WHERE chat_id = ? AND status = 'approved'").get(chat.id) as any).n === 2 || undefined);
    const remoteBranches = () => execFileSync("git", ["branch", "--list", "task/*"], { cwd: bare }).toString();
    expect(remoteBranches()).toContain("task/one");
    expect(remoteBranches()).toContain("task/two");

    await call("POST", `/api/chats/${chat.id}/messages`, { content: "merge them" });
    const answer = await waitFor(() => ctx.db.prepare("SELECT plan FROM messages WHERE chat_id = ? AND role = 'assistant' AND content = 'merging'").get(chat.id) as any);
    const one = ctx.db.prepare("SELECT id FROM tasks WHERE slug = 'one'").get() as any;
    expect(JSON.parse(answer.plan).merge_ids).toEqual([one.id]); // unknown slugs are dropped
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM tasks WHERE chat_id = ?").get(chat.id)).toEqual({ n: 2 }); // no new tasks

    const two = ctx.db.prepare("SELECT id FROM tasks WHERE slug = 'two'").get() as any;
    await call("POST", `/api/tasks/${two.id}/discard`);
    expect(remoteBranches()).not.toContain("task/two");
    expect(remoteBranches()).toContain("task/one");
    rmSync(bare, { recursive: true, force: true });
  });

  it("sorts every task into exactly one tab: active, attention, done (in a sprint), released or archive", async () => {
    const call = (ctx as any).call;
    const project = await call("POST", "/api/projects", { name: "open", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const add = (slug: string, status: string, branch: string, worktree: string) => ctx.db.prepare(
      "INSERT INTO tasks (chat_id, project_id, slug, title, spec, status, branch, worktree) VALUES (?, ?, ?, ?, 'x', ?, ?, ?)")
      .run(chat.id, project.id, slug, slug, status, branch, worktree);
    for (const s of ["queued", "building", "verifying", "reviewing"]) add(s, s, "task/" + s, "/wt/" + s);
    for (const s of ["proposed", "approved", "needs_attention", "failed", "interrupted"]) add(s, s, s === "proposed" ? "" : "task/" + s, s === "proposed" ? "" : "/wt/" + s);
    add("stopped", "cancelled", "task/stopped", "/wt/stopped"); // stopped mid-run: worktree kept, can still be retried
    add("merged", "merged", "task/merged", "");                   // no sprint: merged into the base branch
    const sprint = (n: number, status: string) => Number(ctx.db.prepare("INSERT INTO sprints (project_id, number, name, status) VALUES (?, ?, ?, ?)").run(project.id, n, `s${n}`, status).lastInsertRowid);
    for (const [slug, status] of [["in-open-sprint", "done"], ["in-released-sprint", "released"]] as const) {
      add(slug, "merged", "task/" + slug, "");
      ctx.db.prepare("UPDATE tasks SET sprint_id = ? WHERE slug = ?").run(sprint(slug === "in-open-sprint" ? 1 : 2, status), slug);
    }
    add("stopped-early", "cancelled", "", "");                    // stopped before it started
    add("discarded", "cancelled", "task/discarded", "");          // discarded or closed with a sprint: nothing left
    const slugs = async (group: string) => ((await call("GET", `/api/tasks?group=${group}`)) as { slug: string }[]).map((t) => t.slug).sort();
    const tabs = { active: await slugs("active"), attention: await slugs("attention"), done: await slugs("done"), released: await slugs("released"), archive: await slugs("archive") };
    expect(tabs.active).toEqual(["building", "queued", "reviewing", "verifying"]);
    expect(tabs.attention).toEqual(["approved", "failed", "interrupted", "needs_attention", "proposed", "stopped"]);
    expect(tabs.done).toEqual(["in-open-sprint"]);
    expect(tabs.released).toEqual(["in-released-sprint", "merged"]);
    expect(tabs.archive).toEqual(["discarded", "stopped-early"]);
    const all = (await call("GET", `/api/tasks?chat=${chat.id}`)) as unknown[];
    expect(all).toHaveLength(Object.values(tabs).flat().length); // every task is in exactly one tab
    expect((await call("GET", "/api/tasks?group=nope")).error).toMatch(/Unknown task group/);
  });

  it("stores attachments, gives them to the planner, and clears the cache", async () => {
    const call = (ctx as any).call;
    const project = await call("POST", "/api/projects", { name: "att", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const upload = async (name: string, type: string, body: Buffer) => (await ctx.app.inject({
      method: "POST", url: `/api/chats/${chat.id}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      headers: { cookie, host: "localhost", "content-type": "application/octet-stream" }, payload: body,
    })).json();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const img = await upload("screen shot.png", "image/png", png);
    const txt = await upload("../../evil.log", "text/plain", Buffer.from("ERROR at line 3"));
    expect(img.id).toBeGreaterThan(0);
    expect(txt.name).not.toContain("/");

    let seen: any;
    script = (req) => { seen = req.attachments; return ok("p", { reply: "I see a screenshot and a log.", tasks: [] }); };
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "", attachment_ids: [img.id, txt.id] });
    await waitFor(() => seen);
    expect(seen.images.map((i: any) => i.name)).toEqual(["screen shot.png"]);
    expect(seen.images[0].base64).toBe(png.toString("base64"));
    expect(seen.texts[0].content).toBe("ERROR at line 3");

    const data = await call("GET", `/api/chats/${chat.id}`);
    const msg = data.messages.find((m: any) => m.role === "user");
    expect(msg.content).toBe("(see the attached files)");
    expect(msg.attachments.map((a: any) => a.name)).toEqual(["screen shot.png", txt.name]);
    const served = await ctx.app.inject({ method: "GET", url: `/api/attachments/${img.id}`, headers: { cookie, host: "localhost" } });
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.rawPayload.equals(png)).toBe(true);

    const stats = await call("GET", "/api/attachments-cache");
    expect(stats.files).toBe(2);
    expect(stats.folder).toContain("attachments");
    const cleared = await call("DELETE", "/api/attachments-cache");
    expect(cleared.removed).toBe(2);
    expect((await call("GET", "/api/attachments-cache")).files).toBe(0);
    const gone = await ctx.app.inject({ method: "GET", url: `/api/attachments/${img.id}`, headers: { cookie, host: "localhost" } });
    expect(gone.statusCode).toBe(404);
  });

  it("a new chat sees the project's tasks and journal, and can retry a failed task with another developer", async () => {
    const call = (ctx as any).call;
    const bo2 = await call("POST", "/api/agents", { name: "Bea", role: "worker", provider_id: 1 });
    const project = await call("POST", "/api/projects", { name: "carry", source: "local", path: repo });
    const first = await call("POST", "/api/chats", { project_id: project.id });
    let prompts: string[] = [];
    let step = 0;
    script = (req) => {
      if (req.agent.role === "planner") {
        prompts.push(req.prompt);
        step++;
        if (step === 1) return ok("p", { reply: "one task", tasks: [{ slug: "landing", title: "Landing page", spec: "x", paths: ["src/"] }], journal: ["Site is static HTML, no build."] });
        if (step === 2) return ok("p", { reply: "again", tasks: [], retry: [{ slug: "landing", worker: "Bea" }, { slug: "nope" }] });
        return ok("p", { reply: "new", tasks: [{ slug: "landing", title: "Another", spec: "y", paths: ["src/"] }] });
      }
      if (req.agent.name === "Bo") return { ...ok(""), ok: false, error: "model pasted code" };
      execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
      writeFileSync(join(req.cwd, "src", "landing.html"), "<h1>hi</h1>");
      return req.agent.role === "reviewer" ? ok("r", { verdict: "approve", review: "ok" }) : ok("built");
    };
    ctx.orch.start();
    await call("POST", `/api/chats/${first.id}/messages`, { content: "make a landing page" });
    const task = await waitFor(() => ctx.db.prepare("SELECT * FROM tasks WHERE chat_id = ?").get(first.id) as any);
    await call("PUT", `/api/tasks/${task.id}`, { worker_id: ctx.db.prepare("SELECT id FROM agents WHERE name = 'Bo'").get() && (ctx.db.prepare("SELECT id FROM agents WHERE name = 'Bo'").get() as any).id });
    await call("POST", `/api/messages/${task.message_id}/run`);
    await waitFor(() => ctx.orch.task(task.id).status === "failed" || undefined);

    // A second chat in the same project: the planner sees the failed task and the journal note.
    const second = await call("POST", "/api/chats", { project_id: project.id });
    await call("POST", `/api/chats/${second.id}/messages`, { content: "run it again with Bea" });
    const reply = await waitFor(() => ctx.db.prepare("SELECT * FROM messages WHERE chat_id = ? AND role = 'assistant'").get(second.id) as any);
    expect(prompts[1]).toContain('landing [failed] "Landing page" (developer Bo, chat "make a landing page") — Bo did not finish: model pasted code');
    expect(prompts[1]).toContain("Site is static HTML, no build.");
    const plan = JSON.parse(reply.plan);
    expect(plan.retry).toEqual([{ id: task.id, worker_id: bo2.id }]);

    await call("POST", `/api/tasks/${task.id}/retry`, { worker_id: bo2.id });
    const done = await waitFor(() => { const t = ctx.orch.task(task.id); return t.status === "approved" ? t : undefined; });
    expect(done.worker_id).toBe(bo2.id);

    // Slugs stay unique across the project's chats (they name the branches).
    await call("POST", `/api/chats/${second.id}/messages`, { content: "another landing" });
    const t2 = await waitFor(() => ctx.db.prepare("SELECT slug FROM tasks WHERE chat_id = ?").get(second.id) as any);
    expect(t2.slug).toBe("landing-2");
    const journal = await call("GET", `/api/projects/${project.id}/journal`);
    expect(journal.map((j: any) => j.text)).toEqual(["Site is static HTML, no build."]);
  });

  it("pauses on a command outside the list until the user decides, and 'always' adds a rule", async () => {
    const call = (ctx as any).call;
    const project = await call("POST", "/api/projects", { name: "ask", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    let answers: any[] = [];
    script = (req) => {
      if (req.agent.role === "planner") return ok("p", { reply: "t", tasks: [{ slug: "pkg", title: "Add pkg", spec: "x", paths: ["src/"] }] });
      if (req.agent.role === "reviewer") return ok("r", { verdict: "approve", review: "ok" });
      return (async () => {
        answers.push(await req.askApproval!({ kind: "command", command: "npm install left-pad", cwd: req.cwd }));
        execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
        writeFileSync(join(req.cwd, "src", "p.txt"), "x");
        return ok("built");
      })() as any;
    };
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "add a package" });
    const task = await waitFor(() => ctx.db.prepare("SELECT * FROM tasks WHERE chat_id = ?").get(chat.id) as any);
    await call("POST", `/api/messages/${task.message_id}/run`);
    const ap = await waitFor(() => (ctx.db.prepare("SELECT * FROM approvals WHERE status = 'pending'").get() as any));
    expect(ap.request).toBe("npm install left-pad");
    const list = await call("GET", "/api/approvals?pending=1");
    expect(list[0].agent).toBe("Bo");
    expect(list[0].task).toBe("Add pkg");
    expect(ctx.orch.task(task.id).status).toBe("building"); // paused, not failed

    const bad = await call("POST", `/api/approvals/${ap.id}`, { allow: true, always: true, prefix: "yarn" });
    expect(bad.error).toContain("start of the command");
    const decided = await call("POST", `/api/approvals/${ap.id}`, { allow: true, always: true, prefix: "npm install" });
    expect(decided.status).toBe("allowed");
    expect(decided.decided_by).toBe("jan");
    expect(decided.rule).toBe("Bash(npm install:*)");
    await waitFor(() => ctx.orch.task(task.id).status === "approved" || undefined);
    expect(answers).toEqual([{ allowed: true, by: "jan" }]);
    const bo = ctx.db.prepare("SELECT allowed_tools FROM agents WHERE name = 'Bo'").get() as any;
    expect(JSON.parse(bo.allowed_tools)).toContain("Bash(npm install:*)");
  });

  it("teams: a project's team plans, builds and reviews; a chat can switch team; agents can be in several", async () => {
    const call = (ctx as any).call;
    const prov = (await call("GET", "/api/providers")).providers[0];
    const ids: Record<string, number> = {};
    for (const a of await call("GET", "/api/agents")) ids[a.name] = a.id;
    for (const [name, role] of [["Ines", "planner"], ["Jo", "worker"], ["Kai", "reviewer"]]) {
      ids[name] = (await call("POST", "/api/agents", { name, role, provider_id: prov.id })).id;
    }
    const web = await call("POST", "/api/teams", { name: "Web", member_ids: [ids.Ada, ids.Bo, ids.Cy], planner_id: ids.Ada, reviewer_id: ids.Cy });
    const intg = await call("POST", "/api/teams", { name: "Integration", member_ids: [ids.Ines, ids.Jo, ids.Kai, ids.Cy], planner_id: ids.Ines, reviewer_id: ids.Kai });
    expect((await call("POST", "/api/teams", { name: "Web" })).error).toContain("already exists");
    // a lead who is not a member (or has another role) is dropped
    await call("PUT", `/api/teams/${web.id}`, { name: "Web", planner_id: ids.Ines, reviewer_id: ids.Cy });
    expect((await call("GET", "/api/teams")).find((t: any) => t.id === web.id).planner_id).toBeNull();
    await call("PUT", `/api/teams/${web.id}`, { name: "Web", planner_id: ids.Ada, reviewer_id: ids.Cy });
    expect((await call("GET", "/api/agents")).find((a: any) => a.name === "Cy").team_ids.sort()).toEqual([web.id, intg.id].sort());

    const project = await call("POST", "/api/projects", { name: "int", source: "local", path: repo, team_id: intg.id });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const who: string[] = [];
    script = (req) => {
      who.push(req.agent.name);
      if (req.agent.role === "planner") return ok("p", { reply: "t", tasks: [{ slug: `t-${who.length}`, title: "T", spec: "x", paths: ["src/"], worker: "Bo" }] });
      if (req.agent.role === "reviewer") return ok("r", { verdict: "approve", review: "ok" });
      execFileSync("mkdir", ["-p", join(req.cwd, "src")]);
      writeFileSync(join(req.cwd, "src", `${who.length}.txt`), "x");
      return ok("built");
    };
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "do it" });
    const task = await waitFor(() => ctx.db.prepare("SELECT * FROM tasks WHERE chat_id = ?").get(chat.id) as any);
    // Bo is not in this team: the planner's choice is ignored and the team's developer gets it.
    expect(task.worker_id).toBe(ids.Jo);
    expect((await call("GET", `/api/chats/${chat.id}/planner-capabilities`)).agent).toBe("Ines");
    await call("POST", `/api/messages/${task.message_id}/run`);
    await waitFor(() => ctx.orch.task(task.id).status === "approved" || undefined);
    expect(who).toEqual(["Ines", "Jo", "Kai"]);

    // the chat switches to the Web team; null goes back to the project's team
    await call("PUT", `/api/chats/${chat.id}`, { team_id: web.id });
    expect((await call("GET", `/api/chats/${chat.id}/planner-capabilities`)).agent).toBe("Ada");
    await call("PUT", `/api/chats/${chat.id}`, { team_id: null });
    expect((await call("GET", `/api/chats/${chat.id}/planner-capabilities`)).agent).toBe("Ines");

    // deleting the team: the project falls back to every agent
    await call("DELETE", `/api/teams/${intg.id}`);
    expect(ctx.db.prepare("SELECT team_id FROM projects WHERE id = ?").get(project.id)).toEqual({ team_id: null });
    expect((await call("GET", `/api/chats/${chat.id}/planner-capabilities`)).agent).toBe("Ada");
  });

  it("the gallery has a template for every category, and developer templates start with their specialty", async () => {
    const g = await (ctx as any).call("GET", "/api/agents/gallery");
    for (const c of g.categories) expect(g.items.some((i: any) => i.category === c.id)).toBe(true);
    expect(new Set(g.items.map((i: any) => i.id)).size).toBe(g.items.length);
    for (const i of g.items) {
      expect(["planner", "worker", "reviewer"]).toContain(i.role);
      if (i.role === "worker") {
        expect(i.context.split("\n")[0]).toMatch(/^Specialty: /);
        expect(i.allowed_tools.length).toBeGreaterThan(0);
      } else expect(i.allowed_tools).toEqual([]);
    }
  });
});
