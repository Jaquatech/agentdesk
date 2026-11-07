import type { FastifyInstance, FastifyReply } from "fastify";
import { existsSync, readdirSync } from "node:fs";
import { join, isAbsolute, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { DB } from "./db.ts";
import { getSettings, setSetting, DEFAULT_SETTINGS, json } from "./db.ts";
import { secretHint, type Vault } from "./crypto.ts";
import { bus, type LiveEvent } from "./bus.ts";
import { testProvider, secretValue, DEFAULT_BASE_URL, type ProviderRow } from "./providers/index.ts";
import { ROLE_TEMPLATES } from "./orchestrator/prompts.ts";
import { setAgentTeams } from "./teams.ts";
import { galleryForUi } from "./gallery.ts";
import { DEFAULT_WORKER_TOOLS } from "./engines/types.ts";
import { deleteChatFiles } from "./attachments.ts";
import { getCapabilities } from "./providers/capabilities.ts";
import type { Orchestrator } from "./orchestrator/orchestrator.ts";

type Body = Record<string, any>;
const id = (v: unknown) => Number(v);
const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });

/** Task tabs in Running tasks (SQL on `tasks t`). Disjoint, and together they cover every status. */
const TASK_GROUPS: Record<string, string> = {
  active: "t.status IN ('queued','building','verifying','reviewing')",
  attention: "(t.status IN ('proposed','approved','needs_attention','failed','interrupted') OR (t.status = 'cancelled' AND t.worktree != ''))",
  done: "t.status = 'merged'",
  archive: "(t.status = 'cancelled' AND t.worktree = '')",
};

function sqlError(reply: FastifyReply, err: unknown) {
  const m = String((err as Error).message);
  if (m.includes("UNIQUE")) return bad(reply, "That name is already in use", 409);
  if (m.includes("CHECK")) return bad(reply, "A value is not allowed");
  return bad(reply, m);
}

export function registerRoutes(app: FastifyInstance, db: DB, vault: Vault, orch: Orchestrator, dataDir: string) {
  // ---------- settings ----------
  app.get("/api/settings", async () => getSettings(db));
  app.put("/api/settings", async (req) => {
    const body = req.body as Body;
    for (const [k, v] of Object.entries(body)) {
      if (k in DEFAULT_SETTINGS || /^default_(planner|worker|reviewer)_id$/.test(k)) setSetting(db, k, String(v));
    }
    orch.tick();
    return getSettings(db);
  });

  // ---------- secrets (values never leave the server) ----------
  app.get("/api/secrets", async () =>
    db.prepare("SELECT id, name, hint, updated_at FROM secrets ORDER BY name").all());
  app.post("/api/secrets", async (req, reply) => {
    const { name, value } = req.body as Body;
    if (!name?.trim() || !value?.trim()) return bad(reply, "Name and value are required");
    try {
      const info = db.prepare("INSERT INTO secrets (name, ciphertext, hint) VALUES (?, ?, ?)")
        .run(name.trim(), vault.encrypt(value.trim()), secretHint(value));
      return { id: Number(info.lastInsertRowid) };
    } catch (err) { return sqlError(reply, err); }
  });
  app.put("/api/secrets/:id", async (req, reply) => {
    const { value, name } = req.body as Body;
    if (value?.trim()) {
      db.prepare("UPDATE secrets SET ciphertext = ?, hint = ?, updated_at = datetime('now') WHERE id = ?")
        .run(vault.encrypt(value.trim()), secretHint(value), id((req.params as Body).id));
    }
    if (name?.trim()) {
      try { db.prepare("UPDATE secrets SET name = ? WHERE id = ?").run(name.trim(), id((req.params as Body).id)); }
      catch (err) { return sqlError(reply, err); }
    }
    return { ok: true };
  });
  app.delete("/api/secrets/:id", async (req) => {
    db.prepare("DELETE FROM secrets WHERE id = ?").run(id((req.params as Body).id));
    return { ok: true };
  });

  // ---------- providers ----------
  app.get("/api/providers", async () => ({
    providers: db.prepare(`SELECT p.*, s.name AS secret_name FROM providers p LEFT JOIN secrets s ON s.id = p.secret_id ORDER BY p.name`).all(),
    defaults: DEFAULT_BASE_URL,
  }));
  const providerFields = (b: Body) => ({
    name: String(b.name ?? "").trim(), kind: b.kind, base_url: String(b.base_url ?? "").trim(),
    secret_id: b.secret_id ? id(b.secret_id) : null, default_model: String(b.default_model ?? "").trim(),
    price_in: Number(b.price_in) || 0, price_out: Number(b.price_out) || 0,
  });
  app.post("/api/providers", async (req, reply) => {
    const f = providerFields(req.body as Body);
    if (!f.name) return bad(reply, "Name is required");
    if (f.base_url && !/^https?:\/\//i.test(f.base_url)) return bad(reply, "Base URL must start with http:// or https://");
    try {
      const info = db.prepare(`INSERT INTO providers (name, kind, base_url, secret_id, default_model, price_in, price_out)
        VALUES (@name, @kind, @base_url, @secret_id, @default_model, @price_in, @price_out)`).run(f);
      return { id: Number(info.lastInsertRowid) };
    } catch (err) { return sqlError(reply, err); }
  });
  app.put("/api/providers/:id", async (req, reply) => {
    const f = providerFields(req.body as Body);
    try {
      db.prepare(`UPDATE providers SET name = @name, kind = @kind, base_url = @base_url, secret_id = @secret_id,
        default_model = @default_model, price_in = @price_in, price_out = @price_out WHERE id = @id`)
        .run({ ...f, id: id((req.params as Body).id) });
      return { ok: true };
    } catch (err) { return sqlError(reply, err); }
  });
  app.delete("/api/providers/:id", async (req) => {
    db.prepare("DELETE FROM providers WHERE id = ?").run(id((req.params as Body).id));
    return { ok: true };
  });
  // Test before saving: the form's current values, with a pasted key or a stored secret.
  app.post("/api/providers/test-config", async (req) => {
    const b = req.body as Body;
    const row = { id: 0, ...providerFields(b) } as ProviderRow;
    const pasted = String(b.key ?? "").trim();
    return testProvider(db, vault, row, pasted || undefined);
  });
  // What a model can do (images, tool calls). Ollama is asked; Claude is known; others are "unknown".
  app.get("/api/providers/:id/capabilities", async (req, reply) => {
    const p = db.prepare("SELECT * FROM providers WHERE id = ?").get(id((req.params as Body).id)) as ProviderRow | undefined;
    if (!p) return bad(reply, "Not found", 404);
    const model = String((req.query as Body).model || p.default_model);
    return { model, ...(await getCapabilities(p.kind, p.base_url, model, secretValue(db, vault, p.secret_id))) };
  });
  app.get("/api/chats/:id/planner-capabilities", async (req) => {
    const planner = orch.plannerFor(id((req.params as Body).id));
    const a = planner && db.prepare("SELECT a.*, p.kind, p.base_url, p.default_model, p.secret_id FROM agents a JOIN providers p ON p.id = a.provider_id WHERE a.id = ?")
      .get(planner.id) as (Body & { id: number }) | undefined;
    if (!a) return { agent: null, model: "", vision: null, tools: null, source: "no planner" };
    const model = a.model || a.default_model;
    return { agent: a.name, model, ...(await getCapabilities(a.kind, a.base_url, model, secretValue(db, vault, a.secret_id as number | null))) };
  });
  app.post("/api/providers/:id/test", async (req, reply) => {
    const p = db.prepare("SELECT * FROM providers WHERE id = ?").get(id((req.params as Body).id)) as ProviderRow | undefined;
    if (!p) return bad(reply, "Not found", 404);
    return testProvider(db, vault, p);
  });

  // ---------- agents ----------
  app.get("/api/agents", async () => (db.prepare(`SELECT a.*, p.name AS provider_name, p.kind AS provider_kind,
      (SELECT group_concat(m.team_id) FROM team_members m WHERE m.agent_id = a.id) AS teams
    FROM agents a LEFT JOIN providers p ON p.id = a.provider_id ORDER BY a.role, a.name`).all() as Body[])
    .map(({ teams, ...a }) => ({ ...a, team_ids: teams ? String(teams).split(",").map(Number) : [] })));
  app.get("/api/agents/gallery", async () => galleryForUi());
  app.get("/api/agents/templates", async () => ({ contexts: ROLE_TEMPLATES, workerTools: DEFAULT_WORKER_TOOLS }));
  const agentFields = (b: Body) => ({
    name: String(b.name ?? "").trim(), role: b.role, provider_id: b.provider_id ? id(b.provider_id) : null,
    model: String(b.model ?? "").trim(), context: String(b.context ?? ""),
    max_turns: Math.max(1, Number(b.max_turns) || 80), timeout_min: Math.max(1, Number(b.timeout_min) || 60),
    allowed_tools: JSON.stringify(Array.isArray(b.allowed_tools) ? b.allowed_tools : json.parse(b.allowed_tools, [])),
    appearance: JSON.stringify(b.appearance ?? {}), enabled: b.enabled === false ? 0 : 1,
    ask_approval: b.ask_approval === false || b.ask_approval === 0 ? 0 : 1,
    thinking: b.thinking === "off" ? "off" : "",
  });
  app.post("/api/agents", async (req, reply) => {
    const f = agentFields(req.body as Body);
    if (!f.name) return bad(reply, "Name is required");
    try {
      const info = db.prepare(`INSERT INTO agents (name, role, provider_id, model, context, max_turns, timeout_min, allowed_tools, appearance, enabled, ask_approval, thinking)
        VALUES (@name, @role, @provider_id, @model, @context, @max_turns, @timeout_min, @allowed_tools, @appearance, @enabled, @ask_approval, @thinking)`).run(f);
      const agentId = Number(info.lastInsertRowid);
      if (Array.isArray((req.body as Body).team_ids)) setAgentTeams(db, agentId, (req.body as Body).team_ids.map(Number));
      bus.publish({ type: "agent", agentId, state: "idle" });
      return { id: agentId };
    } catch (err) { return sqlError(reply, err); }
  });
  app.put("/api/agents/:id", async (req, reply) => {
    const f = agentFields(req.body as Body);
    try {
      db.prepare(`UPDATE agents SET name = @name, role = @role, provider_id = @provider_id, model = @model, context = @context,
        max_turns = @max_turns, timeout_min = @timeout_min, allowed_tools = @allowed_tools, appearance = @appearance,
        enabled = @enabled, ask_approval = @ask_approval, thinking = @thinking WHERE id = @id`).run({ ...f, id: id((req.params as Body).id) });
      if (Array.isArray((req.body as Body).team_ids)) setAgentTeams(db, id((req.params as Body).id), (req.body as Body).team_ids.map(Number));
      return { ok: true };
    } catch (err) { return sqlError(reply, err); }
  });
  app.delete("/api/agents/:id", async (req) => {
    db.prepare("DELETE FROM agents WHERE id = ?").run(id((req.params as Body).id));
    return { ok: true };
  });

  // ---------- projects ----------
  app.get("/api/projects", async () => db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chat_count FROM projects p ORDER BY p.name`).all());
  const projectFields = (b: Body) => {
    const name = String(b.name ?? "").trim();
    let path = String(b.path ?? "").trim();
    const repoUrl = String(b.repo_url ?? "").trim();
    if (!path && b.source !== "local") path = join(dataDir, "repos", name.replace(/[^\w.-]+/g, "-"));
    // A parent folder given for a remote repo (exists, not a clone, has files): clone into <parent>/<repo name>.
    else if (b.source !== "local" && path && existsSync(path) && !existsSync(join(path, ".git")) && readdirSync(path).length > 0) {
      const repoName = repoUrl.replace(/\.git$/, "").split(/[\/:]/).filter(Boolean).pop() || name.replace(/[^\w.-]+/g, "-");
      path = join(path, repoName);
    }
    return {
      name, source: b.source, path: path && !isAbsolute(path) ? resolve(path) : path,
      repo_url: String(b.repo_url ?? "").trim(), base_branch: String(b.base_branch || "main").trim(),
      shell: b.shell || "auto",
      setup: JSON.stringify(lines(b.setup)), verify: JSON.stringify(lines(b.verify)),
      allowed_paths: JSON.stringify(lines(b.allowed_paths)), context: String(b.context ?? ""),
      team_id: b.team_id ? id(b.team_id) : null,
    };
  };
  /** How the project's work is run: "free" chat or "scrum"; and the points one developer does per sprint. Only when sent. */
  const processFields = (projectId: number, b: Body) => {
    if (b.process === "free" || b.process === "scrum") db.prepare("UPDATE projects SET process = ? WHERE id = ?").run(b.process, projectId);
    if (b.points_per_dev !== undefined) db.prepare("UPDATE projects SET points_per_dev = ? WHERE id = ?").run(Math.max(1, Math.min(60, Math.round(Number(b.points_per_dev)) || 8)), projectId);
  };
  app.post("/api/projects", async (req, reply) => {
    const f = projectFields(req.body as Body);
    if (!f.name) return bad(reply, "Name is required");
    if (!f.path) return bad(reply, "Folder is required");
    if (f.source !== "local" && !f.repo_url) return bad(reply, "Repository URL is required");
    try {
      const info = db.prepare(`INSERT INTO projects (name, source, path, repo_url, base_branch, shell, setup, verify, allowed_paths, context, team_id)
        VALUES (@name, @source, @path, @repo_url, @base_branch, @shell, @setup, @verify, @allowed_paths, @context, @team_id)`).run(f);
      processFields(Number(info.lastInsertRowid), req.body as Body);
      return { id: Number(info.lastInsertRowid) };
    } catch (err) { return sqlError(reply, err); }
  });
  app.put("/api/projects/:id", async (req, reply) => {
    const f = projectFields(req.body as Body);
    try {
      db.prepare(`UPDATE projects SET name = @name, source = @source, path = @path, repo_url = @repo_url, base_branch = @base_branch,
        shell = @shell, setup = @setup, verify = @verify, allowed_paths = @allowed_paths, context = @context, team_id = @team_id WHERE id = @id`)
        .run({ ...f, id: id((req.params as Body).id) });
      processFields(id((req.params as Body).id), req.body as Body);
      return { ok: true };
    } catch (err) { return sqlError(reply, err); }
  });
  app.delete("/api/projects/:id", async (req) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(id((req.params as Body).id));
    return { ok: true };
  });
  // Folder picker for the project form (the browser cannot hand out absolute paths).
  app.get("/api/fs/dirs", async (req) => {
    const raw = String((req.query as Body).path ?? "");
    if (!raw) {
      const roots = process.platform === "win32"
        ? "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((d) => `${d}:\\`).filter((d) => existsSync(d))
        : ["/"];
      return { path: "", parent: null, dirs: [...roots, homedir()].map((p) => ({ name: p, path: p, git: existsSync(join(p, ".git")) })) };
    }
    const dir = resolve(raw);
    let entries: { name: string; path: string; git: boolean }[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => ({ name: e.name, path: join(dir, e.name), git: existsSync(join(dir, e.name, ".git")) }))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
    } catch { /* unreadable folder */ }
    const parent = dirname(dir);
    return { path: dir, parent: parent === dir ? "" : parent, git: existsSync(join(dir, ".git")), dirs: entries };
  });
  app.post("/api/projects/draft-notes", async (req, reply) => {
    const path = String((req.body as Body).path ?? "");
    if (!path || !existsSync(path)) return bad(reply, "Set an existing folder first");
    try { return { notes: await orch.draftProjectNotes(path) }; }
    catch (err) { return bad(reply, String((err as Error).message)); }
  });
  // The project journal: notes the planner keeps for later chats.
  app.get("/api/projects/:id/journal", async (req) => db.prepare(`SELECT j.id, j.text, j.created_at, c.title AS chat, a.name AS agent
    FROM project_journal j LEFT JOIN chats c ON c.id = j.chat_id LEFT JOIN agents a ON a.id = j.agent_id
    WHERE j.project_id = ? ORDER BY j.id DESC`).all(id((req.params as Body).id)));
  app.post("/api/projects/:id/journal", async (req, reply) => {
    const text = String((req.body as Body).text ?? "").trim().slice(0, 400);
    if (!text) return bad(reply, "Empty note");
    db.prepare("INSERT INTO project_journal (project_id, text) VALUES (?, ?)").run(id((req.params as Body).id), text);
    return { ok: true };
  });
  app.delete("/api/journal/:id", async (req) => {
    db.prepare("DELETE FROM project_journal WHERE id = ?").run(id((req.params as Body).id));
    return { ok: true };
  });
  app.post("/api/projects/check-path", async (req) => {
    const { path } = req.body as Body;
    const p = String(path ?? "");
    return { exists: !!p && existsSync(p), git: !!p && existsSync(join(p, ".git")) };
  });

  // ---------- chats ----------
  app.get("/api/chats", async (req) => {
    const { project } = req.query as Body;
    return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.chat_id = c.id AND t.status IN ('queued','building','verifying','reviewing')) AS active_tasks
      FROM chats c ${project ? "WHERE c.project_id = ?" : ""} ORDER BY c.updated_at DESC`).all(...(project ? [id(project)] : []));
  });
  app.post("/api/chats", async (req, reply) => {
    const { project_id, title } = req.body as Body;
    if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id(project_id))) return bad(reply, "Pick a project");
    const info = db.prepare("INSERT INTO chats (project_id, title) VALUES (?, ?)").run(id(project_id), String(title || "New chat"));
    return db.prepare("SELECT * FROM chats WHERE id = ?").get(info.lastInsertRowid);
  });
  app.put("/api/chats/:id", async (req) => {
    const b = req.body as Body;
    const chatId = id((req.params as Body).id);
    if (b.title !== undefined) db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(String(b.title ?? "").slice(0, 120), chatId);
    // team_id null = the project's team
    if (b.team_id !== undefined) db.prepare("UPDATE chats SET team_id = ? WHERE id = ?").run(b.team_id ? id(b.team_id) : null, chatId);
    return { ok: true };
  });
  app.delete("/api/chats/:id", async (req) => {
    db.prepare("DELETE FROM chats WHERE id = ?").run(id((req.params as Body).id));
    deleteChatFiles(dataDir, id((req.params as Body).id));
    return { ok: true };
  });
  app.get("/api/chats/:id", async (req, reply) => {
    const chatId = id((req.params as Body).id);
    const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId);
    if (!chat) return bad(reply, "Not found", 404);
    return {
      chat,
      planning: orch.isPlanning(chatId),
      messages: (() => {
        const files = db.prepare("SELECT id, message_id, name, mime, size FROM attachments WHERE chat_id = ? AND message_id IS NOT NULL ORDER BY id")
          .all(chatId) as { message_id: number }[];
        return (db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY id").all(chatId) as { id: number }[])
          .map((m) => ({ ...m, attachments: files.filter((f) => f.message_id === m.id) }));
      })(),
      tasks: db.prepare("SELECT * FROM tasks WHERE chat_id = ? ORDER BY id").all(chatId),
    };
  });
  app.post("/api/chats/:id/messages", async (req, reply) => {
    const chatId = id((req.params as Body).id);
    let content = String((req.body as Body).content ?? "").trim();
    const ids = (Array.isArray((req.body as Body).attachment_ids) ? (req.body as Body).attachment_ids : []).map(Number).filter(Number.isFinite);
    if (!content && !ids.length) return bad(reply, "Empty message");
    if (!content) content = "(see the attached files)";
    const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as { title: string } | undefined;
    if (!chat) return bad(reply, "Not found", 404);
    if (orch.isPlanning(chatId)) return bad(reply, "The planner is still answering the previous message", 409);
    if (chat.title === "New chat") db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(content.split("\n")[0].slice(0, 60), chatId);
    // Attach the uploaded files before anyone sees the message, then tell the UI again with the files.
    const message = orch.postMessage(chatId, "user", content, null, undefined, ids.length ? (m) => {
      const link = db.prepare("UPDATE attachments SET message_id = ? WHERE id = ? AND chat_id = ? AND message_id IS NULL");
      for (const a of ids) link.run(m, a, chatId);
    } : undefined);
    void orch.plan(chatId);
    return message;
  });
  app.post("/api/messages/:id/run", async (req) => ({ queued: orch.approvePlan(id((req.params as Body).id)) }));

  // ---------- tasks ----------
  app.get("/api/tasks", async (req, reply) => {
    const { chat, group, ids } = req.query as Body;
    const where: string[] = [];
    const args: unknown[] = [];
    if (ids) {
      const list = String(ids).split(",").map(Number).filter(Number.isFinite).slice(0, 50);
      where.push(`t.id IN (${list.map(() => "?").join(",") || "NULL"})`);
      args.push(...list);
    }
    if (chat) { where.push("t.chat_id = ?"); args.push(id(chat)); }
    // Groups are disjoint and cover every task: active (in progress), attention (waiting for the user or retryable),
    // done (merged) and archive (cancelled with no worktree left: discarded, dropped with a sprint, never started).
    if (group) {
      const clause = TASK_GROUPS[String(group)];
      if (!clause) return bad(reply, `Unknown task group: ${group}`);
      where.push(clause);
    }
    return db.prepare(`SELECT t.*, c.title AS chat_title, p.name AS project_name FROM tasks t
      JOIN chats c ON c.id = t.chat_id JOIN projects p ON p.id = t.project_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.updated_at DESC LIMIT 200`).all(...args);
  });
  app.get("/api/tasks/:id", async (req, reply) => {
    const taskId = id((req.params as Body).id);
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) return bad(reply, "Not found", 404);
    // The list leaves out the (large) transcripts; /api/runs/:id has them.
    return { task, runs: db.prepare(`SELECT id, task_id, chat_id, agent_id, kind, round, model, engine, status, turns, cost_usd, tokens_in, cache_read,
      cache_write, tokens_out, seconds, summary, log, started_at, ended_at, transcript IS NOT NULL AS has_transcript
      FROM runs WHERE task_id = ? ORDER BY id`).all(taskId) };
  });
  app.put("/api/tasks/:id", async (req, reply) => {
    const taskId = id((req.params as Body).id);
    const t = orch.task(taskId);
    if (!t) return bad(reply, "Not found", 404);
    if (t.status !== "proposed") return bad(reply, "Only proposed tasks can be edited");
    const b = req.body as Body;
    db.prepare("UPDATE tasks SET title = ?, spec = ?, paths = ?, worker_id = ? WHERE id = ?")
      .run(String(b.title ?? t.title), String(b.spec ?? t.spec), JSON.stringify(lines(b.paths ?? json.parse(t.paths, []))),
        b.worker_id ? id(b.worker_id) : t.worker_id, taskId);
    const updated = orch.task(taskId);
    bus.publish({ type: "task", chatId: updated.chat_id, task: updated });
    return updated;
  });
  // ---------- approvals ----------
  app.get("/api/approvals", async (req) => {
    const { pending, task } = req.query as Body;
    const ids = db.prepare(`SELECT id FROM approvals WHERE ${pending ? "status = 'pending'" : "1 = 1"} ${task ? "AND task_id = ?" : ""}
      ORDER BY id DESC LIMIT 100`).all(...(task ? [id(task)] : [])) as { id: number }[];
    return ids.map((r) => orch.approval(r.id));
  });
  app.post("/api/approvals/:id", async (req, reply) => {
    const b = req.body as Body;
    const user = db.prepare("SELECT username FROM users WHERE id = ?").get(req.userId) as { username: string } | undefined;
    try {
      return orch.decide(id((req.params as Body).id), { allow: !!b.allow, always: !!b.always, prefix: b.prefix ? String(b.prefix) : undefined, by: user?.username ?? "user" });
    } catch (err) { return bad(reply, String((err as Error).message)); }
  });
  app.get("/api/runs/:id", async (req, reply) => {
    const run = db.prepare(`SELECT r.*, a.name AS agent FROM runs r LEFT JOIN agents a ON a.id = r.agent_id WHERE r.id = ?`)
      .get(id((req.params as Body).id)) as Body | undefined;
    if (!run) return bad(reply, "Not found", 404);
    return { ...run, transcript: run.transcript ? json.parse(run.transcript, []) : orch.liveTranscript(run.id) ?? [] };
  });
  const action = (name: string, fn: (taskId: number) => unknown) =>
    app.post(`/api/tasks/:id/${name}`, async (req, reply) => {
      try { return { ok: true, result: await fn(id((req.params as Body).id)) }; }
      catch (err) { return bad(reply, String((err as Error).message)); }
    });
  action("cancel", (t) => orch.cancel(t));
  app.post("/api/tasks/:id/retry", async (req, reply) => {
    try { orch.retry(id((req.params as Body).id), (req.body as Body)?.worker_id ? id((req.body as Body).worker_id) : undefined); return { ok: true }; }
    catch (err) { return bad(reply, String((err as Error).message)); }
  });
  action("merge", (t) => orch.merge(t));
  action("discard", (t) => orch.discard(t));

  // ---------- office ----------
  app.get("/api/office", async () => ({
    settings: getSettings(db),
    agents: db.prepare("SELECT id, name, role, appearance, enabled FROM agents ORDER BY id").all(),
    activity: bus.snapshot(),
  }));
  // ---------- live events (Server-Sent Events) ----------
  app.get("/api/events", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no",
    });
    const send = (ev: LiveEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    reply.raw.write(`data: ${JSON.stringify({ type: "hello", activity: bus.snapshot() })}\n\n`);
    bus.on("event", send);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    req.raw.on("close", () => { bus.off("event", send); clearInterval(ping); });
  });
}

function lines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
