import { join } from "node:path";
import type { DB } from "../db.ts";
import { getSettings, json } from "../db.ts";
import { pickAgent, pickPlanner, teamAgents, teamOfChat, teamOfProject, team } from "../teams.ts";
import type { Scrum } from "../scrum.ts";
import { overBudget } from "../budget.ts";
import type { Vault } from "../crypto.ts";
import { bus, type AgentState } from "../bus.ts";
import type { AgentRow, EngineRequest, EngineResult, TranscriptEntry } from "../engines/types.ts";
import { resolveProvider, engineFor } from "../providers/index.ts";
import {
  ensureProjectCheckout, ensureWorktree, commitChanges, headSha, diffAgainstBase, projectHasRemote,
  pushAndOpenPr, prComment, mergeTask, removeWorktree, syncBranch, squashInto, ensureSprintWorktree, type ProjectRow,
} from "./git.ts";
import { runCommandLine, tail, type ShellKind } from "./shell.ts";
import { loadForPrompt, type AttachmentRow } from "../attachments.ts";
import { getCapabilities } from "../providers/capabilities.ts";
import { placeEnvFile, type EnvFileHandle } from "./envFile.ts";
import { blockingTask, isStuck, waitKey } from "./overlap.ts";
import { setupProblem } from "../verifyHelp.ts";
import { DEFAULT_WORKER_TOOLS } from "../engines/types.ts";
import { PLAN_TOOL, REVIEW_TOOL, NOTES_TOOL, ROLE_TEMPLATES, buildWorkerPrompt, buildReviewPrompt } from "./prompts.ts";
import { applyWikiWrites, projectWikiContext, syncTaskPage } from "../documents.ts";

export type TaskRow = {
  id: number; chat_id: number; project_id: number; message_id: number | null; slug: string; title: string;
  spec: string; paths: string; worker_id: number | null; reviewer_id: number | null; status: TaskStatus;
  round: number; branch: string; worktree: string; commit_sha: string; pr_url: string; verdict: string;
  summary: string; review: string; error: string; feedback: string; cost_usd: number; tokens: number; created_at: string; updated_at: string;
  item_id: number | null; sprint_id: number | null;
};

export type TaskStatus = "proposed" | "queued" | "building" | "verifying" | "reviewing" | "approved" | "merged"
  | "needs_attention" | "failed" | "cancelled" | "interrupted";

const ACTIVE: TaskStatus[] = ["building", "verifying", "reviewing"];

/**
 * The team lead: the planner turns a chat message into tasks; each task runs
 * worktree → worker → commit (path check) → verify → reviewer → fix rounds → push + PR → human merge.
 */
export class Orchestrator {
  private running = new Map<number, AbortController>();
  private busyAgents = new Set<number>();
  private planning = new Set<number>();
  /** Steps of runs still in progress (the stored transcript is written when a run ends). */
  private liveSteps = new Map<number, TranscriptEntry[]>();

  /** Runs paused on a question to the user: approval id → resolve. */
  private pendingApprovals = new Map<number, (answer: { allowed: boolean; by?: string }) => void>();

  liveTranscript(runId: number) {
    return this.liveSteps.get(runId);
  }

  private step(runId: number, taskId: number | undefined, entry: TranscriptEntry) {
    const list = this.liveSteps.get(runId) ?? [];
    if (list.length < 600) list.push(entry);
    this.liveSteps.set(runId, list);
    bus.publish({ type: "step", taskId, runId, entry });
  }
  private tickTimer?: NodeJS.Timeout;
  /** Scrum: backlog, sprints and releases. Set by the app; a project on the Scrum process is handed to it. */
  scrum?: Scrum;
  /** One merge at a time per sprint branch. */
  private sprintMerges = new Map<number, Promise<unknown>>();
  private budgetTold = new Set<string>();

  constructor(private db: DB, private vault: Vault, public dataDir: string) {}

  start() {
    // Work that was running when the server stopped cannot be resumed mid-call.
    this.db.prepare(`UPDATE tasks SET status = 'interrupted', error = 'Server restarted while this task ran', updated_at = datetime('now')
      WHERE status IN ('building','verifying','reviewing')`).run();
    this.db.prepare(`UPDATE runs SET status = 'interrupted', ended_at = datetime('now') WHERE status = 'running'`).run();
    this.db.prepare(`UPDATE approvals SET status = 'expired', decided_at = datetime('now') WHERE status = 'pending'`).run();
    for (const a of this.db.prepare("SELECT id FROM agents").all() as { id: number }[]) this.activity(a.id, "idle");
    this.tickTimer = setInterval(() => this.tick(), 2000);
  }

  stop() {
    clearInterval(this.tickTimer);
    for (const c of this.running.values()) c.abort();
  }

  // ---------- helpers ----------

  agent(id: number | null | undefined): AgentRow | undefined {
    return id ? this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined : undefined;
  }

  project(id: number): ProjectRow {
    const p = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    if (!p) throw new Error("Project not found");
    return p;
  }

  task(id: number): TaskRow {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
  }

  private activity(agentId: number, state: AgentState, detail?: string, taskId?: number, chatId?: number) {
    bus.publish({ type: "agent", agentId, state, detail, taskId, chatId });
  }

  updateTask(id: number, fields: Partial<TaskRow>) {
    const keys = Object.keys(fields);
    if (keys.length) {
      this.db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...fields, id });
    }
    const watch = ["title", "spec", "summary", "review", "verdict"];
    if (!this.db.prepare("SELECT id FROM documents WHERE task_id = ?").get(id) || keys.some((k) => watch.includes(k))) syncTaskPage(this.db, id);
    const t = this.task(id);
    const page = this.db.prepare("SELECT id FROM documents WHERE task_id = ?").get(id) as { id: number } | undefined;
    (t as TaskRow & { document_id?: number | null }).document_id = page?.id ?? null;
    bus.publish({ type: "task", chatId: t.chat_id, task: t });
    return t;
  }

  postMessage(chatId: number, role: "user" | "assistant" | "event", content: string, agentId?: number | null, plan?: unknown,
    beforePublish?: (messageId: number) => void) {
    const info = this.db.prepare("INSERT INTO messages (chat_id, role, agent_id, content, plan) VALUES (?, ?, ?, ?, ?)")
      .run(chatId, role, agentId ?? null, content, plan ? JSON.stringify(plan) : null);
    this.db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(chatId);
    beforePublish?.(Number(info.lastInsertRowid));
    const message = {
      ...(this.db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as { id: number }),
      attachments: this.db.prepare("SELECT id, name, mime, size FROM attachments WHERE message_id = ? ORDER BY id").all(info.lastInsertRowid),
    };
    bus.publish({ type: "message", chatId, message });
    return message as { id: number };
  }

  private log(taskId: number, line: string) {
    bus.publish({ type: "log", taskId, line });
  }

  private pickAgent(role: "planner" | "worker" | "reviewer", o: { teamId?: number | null; preferred?: number | null; name?: string } = {}) {
    return pickAgent(this.db, role, o);
  }

  /** The planner that answers a chat: the one picked for the chat or project, else its team's planner (or the default one when no team is set). */
  plannerFor(chatId: number) {
    return pickPlanner(this.db, { chatId });
  }

  private startRun(o: { taskId?: number; chatId?: number; projectId?: number; sprintId?: number; itemId?: number; agent: AgentRow; kind: string; round: number; model: string; engine: string }) {
    // A task of a sprint brings its sprint and item to every run, so usage can be reported per sprint.
    const t = o.taskId ? this.db.prepare("SELECT sprint_id, item_id FROM tasks WHERE id = ?").get(o.taskId) as { sprint_id: number | null; item_id: number | null } | undefined : undefined;
    const info = this.db.prepare("INSERT INTO runs (task_id, chat_id, project_id, agent_id, kind, round, model, engine, sprint_id, item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(o.taskId ?? null, o.chatId ?? null, o.projectId ?? null, o.agent.id, o.kind, o.round, o.model, o.engine,
        o.sprintId ?? t?.sprint_id ?? null, o.itemId ?? t?.item_id ?? null);
    return Number(info.lastInsertRowid);
  }

  private endRun(runId: number, r: EngineResult, log: string[]) {
    this.liveSteps.delete(runId);
    this.db.prepare(`UPDATE runs SET status = ?, turns = ?, cost_usd = ?, tokens_in = ?, cache_read = ?, cache_write = ?, tokens_out = ?, seconds = ?,
      transcript = ?, summary = ?, log = ?, ended_at = datetime('now') WHERE id = ?`)
      .run(r.ok ? "done" : "failed", r.turns, r.costUsd, r.tokensIn, r.cacheRead, r.cacheWrite, r.tokensOut, r.seconds,
        r.transcript ? JSON.stringify(r.transcript) : null,
        (r.error ? `ERROR: ${r.error}\n\n` : "") + (r.output?.verdict ? `Verdict: ${r.output.verdict}\n\n` : "") + r.summary.slice(0, 20_000),
        log.slice(-400).join("\n"), runId);
  }

  /** Runs one agent call with activity events, a run record and cost bookkeeping. */
  async callAgent(o: {
    agent: AgentRow; kind: string; chatId?: number; taskId?: number; round?: number; cwd: string; prompt: string;
    mode: "read" | "write"; output?: EngineRequest["output"]; signal?: AbortSignal; idleState?: AgentState; projectId?: number;
    sprintId?: number; itemId?: number;
    attachments?: EngineRequest["attachments"];
  }): Promise<EngineResult> {
    // Spending limits: refuse before anything is spent.
    const taskSprint = o.taskId ? (this.db.prepare("SELECT sprint_id FROM tasks WHERE id = ?").get(o.taskId) as { sprint_id: number | null } | undefined)?.sprint_id : undefined;
    const stop = overBudget(this.db, o.sprintId ?? taskSprint);
    if (stop) return { ok: false, summary: "", turns: 0, costUsd: null, tokensIn: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0, seconds: 0, error: stop };
    const provider = resolveProvider(this.db, this.vault, o.agent);
    const project = o.chatId
      ? this.db.prepare("SELECT p.* FROM projects p JOIN chats c ON c.project_id = p.id WHERE c.id = ?").get(o.chatId) as ProjectRow | undefined
      : o.projectId ? this.db.prepare("SELECT * FROM projects WHERE id = ?").get(o.projectId) as ProjectRow | undefined : undefined;
    const system = [
      o.agent.context || ROLE_TEMPLATES[o.agent.role],
      project?.context ? `# Project notes\n${project.context}` : "",
      project ? projectWikiContext(this.db, project.id) : "",
    ].filter(Boolean).join("\n\n");
    const runId = this.startRun({
      taskId: o.taskId, chatId: o.chatId, projectId: o.projectId ?? project?.id, sprintId: o.sprintId, itemId: o.itemId, agent: o.agent, kind: o.kind,
      round: o.round ?? 0, model: provider.model || (provider.kind === "claude-cli" ? "claude-cli default" : ""), engine: provider.kind,
    });
    const lines: string[] = [];
    this.busyAgents.add(o.agent.id);
    this.activity(o.agent.id, o.kind === "review" ? "reviewing" : "thinking", o.kind, o.taskId, o.chatId);
    try {
      const result = await engineFor(provider).run({
        agent: o.agent, provider, cwd: o.cwd, system, prompt: o.prompt, mode: o.mode, output: o.output, signal: o.signal,
        attachments: o.attachments,
        onActivity: (state, detail) => this.activity(o.agent.id, o.kind === "review" && state === "thinking" ? "reviewing" : state, detail, o.taskId, o.chatId),
        onLog: (line) => { lines.push(line); if (o.taskId) this.log(o.taskId, `[${o.agent.name}] ${line}`); },
        onStep: (entry) => this.step(runId, o.taskId, entry),
        askApproval: o.agent.ask_approval === 0 ? undefined
          : (q) => this.askUser({ ...q, runId, taskId: o.taskId, chatId: o.chatId, agent: o.agent, signal: o.signal }),
        writeWiki: project && o.mode === "write" ? (page) => {
          const n = applyWikiWrites(this.db, project.id, [page]);
          return n ? `Updated ${page.section || "page"} “${page.title}”.` : "No project page was changed. Use a project section, not a General page.";
        } : undefined,
      });
      this.endRun(runId, result, lines);
      if (o.taskId) {
        this.db.prepare("UPDATE tasks SET cost_usd = cost_usd + ?, tokens = tokens + ? WHERE id = ?")
          .run(result.costUsd ?? 0, result.tokensIn + result.cacheRead + result.cacheWrite + result.tokensOut, o.taskId);
      }
      return result;
    } catch (err) {
      const r: EngineResult = { ok: false, summary: "", turns: 0, costUsd: null, tokensIn: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0, seconds: 0, error: String((err as Error).message ?? err) };
      this.endRun(runId, r, lines);
      return r;
    } finally {
      this.busyAgents.delete(o.agent.id);
      this.activity(o.agent.id, "idle", undefined, undefined, undefined);
    }
  }

  // ---------- planning ----------

  isPlanning(chatId: number) {
    return this.planning.has(chatId);
  }

  async plan(chatId: number): Promise<void> {
    if (this.planning.has(chatId)) return;
    const chat = this.db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as { id: number; project_id: number } | undefined;
    if (!chat) return;
    // A Scrum project: the product manager turns the message into backlog items instead of tasks.
    if ((this.db.prepare("SELECT process FROM projects WHERE id = ?").get(chat.project_id) as { process: string } | undefined)?.process === "scrum" && this.scrum) {
      this.planning.add(chatId);
      try { await this.scrum.chat(chatId); } finally { this.planning.delete(chatId); }
      return;
    }
    const teamId = teamOfChat(this.db, chatId);
    const planner = pickPlanner(this.db, { chatId });
    if (!planner) {
      const t = team(this.db, teamId);
      this.postMessage(chatId, "event", t
        ? `Team ${t.name} has no planner. Add one to the team under Teams.`
        : "No planner agent yet. Create one under Agents (role: planner).");
      return;
    }
    this.planning.add(chatId);
    try {
      const project = this.project(chat.project_id);
      await ensureProjectCheckout(project);
      const history = (this.db.prepare(`SELECT m.id, m.role, m.content,
          (SELECT GROUP_CONCAT(a.name, ', ') FROM attachments a WHERE a.message_id = m.id) AS files
        FROM messages m WHERE m.chat_id = ? AND m.role != 'event' ORDER BY m.id DESC LIMIT 20`)
        .all(chatId) as { id: number; role: string; content: string; files: string | null }[]).reverse();
      // The latest user message's files go to the model; earlier ones are only named.
      const latestUser = [...history].reverse().find((m) => m.role === "user");
      const files = latestUser ? this.db.prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY id").all(latestUser.id) as AttachmentRow[] : [];
      let attachments;
      if (files.length) {
        // Images only go to a model that can read them; otherwise the planner is told their names.
        const p = resolveProvider(this.db, this.vault, planner);
        const caps = await getCapabilities(p.kind, p.baseUrl, p.model, p.apiKey);
        attachments = loadForPrompt(files, { vision: caps.vision, model: p.model });
      }
      const workers = teamAgents(this.db, teamId, "worker"); // only this team's developers get work
      // Every chat of the project shares the task list and the journal, so a new chat picks up where the last left off.
      type ProjectTask = { id: number; slug: string; title: string; status: string; error: string; chat_id: number; chat: string; worker: string | null };
      const tasks = (this.db.prepare(`SELECT t.id, t.slug, t.title, t.status, t.error, t.chat_id, c.title AS chat, a.name AS worker
        FROM tasks t JOIN chats c ON c.id = t.chat_id LEFT JOIN agents a ON a.id = t.worker_id
        WHERE t.project_id = ? ORDER BY t.id DESC LIMIT 30`).all(chat.project_id) as ProjectTask[]).reverse();
      const allSlugs = (this.db.prepare("SELECT slug FROM tasks WHERE project_id = ?").all(chat.project_id) as { slug: string }[]).map((t) => t.slug);
      const journal = (this.db.prepare(`SELECT j.text, j.created_at FROM project_journal j WHERE j.project_id = ? ORDER BY j.id DESC LIMIT 40`)
        .all(chat.project_id) as { text: string; created_at: string }[]).reverse();
      const RETRYABLE = ["failed", "needs_attention", "interrupted", "cancelled"];
      const describe = (t: ProjectTask) => `- ${t.slug} [${t.status}] "${t.title}" (developer ${t.worker ?? "any"}${t.chat_id === chatId ? ", this chat" : `, chat "${t.chat}"`})` +
        (t.error && RETRYABLE.includes(t.status) ? ` — ${t.error.split("\n")[0].slice(0, 160)}` : "");
      const verify = json.parse<string[]>(project.verify, []);
      const prompt = `# Conversation
${history.map((m) => `## ${m.role === "user" ? "User" : "You (earlier)"}\n${m.content}${m.files && m.id !== latestUser?.id ? `\n(attached earlier: ${m.files})` : ""}`).join("\n\n")}

# Team
Developer agents: ${workers.map((w) => `${w.name} (${firstLine(w.context) || "developer"})`).join("; ") || "(none yet)"}.
Verify commands run after every task: ${verify.join(" ; ") || "(none set)"}.

# Tasks in this project (all chats, newest last)
${tasks.map(describe).join("\n") || "none yet"}

# Project journal (notes from earlier chats, oldest first)
${journal.map((j) => `- ${j.created_at.slice(0, 10)}: ${j.text}`).join("\n") || "empty"}
Base branch: ${project.base_branch}. You are in the project folder (read-only for you).

Answer the latest user message. If code must change, write the tasks; otherwise return an empty task list.
If the user asks to merge finished work, do not write tasks for it: put the slugs of the approved tasks to merge in \`merge\`
(they then get a Merge button). Approved tasks: ${tasks.filter((t) => t.status === "approved").map((t) => t.slug).join(", ") || "none"}.
If the user asks to run earlier tasks again, put them in \`retry\` (any chat of this project; set \`worker\` to hand one to another
developer) instead of writing new tasks. Retryable: ${tasks.filter((t) => RETRYABLE.includes(t.status)).map((t) => t.slug).join(", ") || "none"}.
Add to \`journal\` only what a later chat must know (a decision, a finding, why something failed); usually nothing.
You may update this project's wiki with \`wiki\`: each item has a title, a section (overview, architecture, roadmap, setup, decisions, releases) and a markdown body.
overview, architecture, roadmap and setup replace that one page. decisions and releases add a page, or replace the one with the same title.
Do not put this project's name, its data, or a customer name into General pages. You cannot edit those from here.`;

      const result = await this.callAgent({ agent: planner, kind: "plan", chatId, cwd: project.path, prompt, mode: "read", output: PLAN_TOOL, attachments });
      if (!result.ok || !result.output) {
        this.postMessage(chatId, "event", `Planner ${planner.name} failed: ${result.error ?? "no plan returned"}`, planner.id);
        return;
      }
      const plan = normalizePlan(result.output, allSlugs); // slugs are unique per project: they name branches
      const bySlug = new Map(tasks.map((t) => [t.slug, t]));
      // Actions refer to task ids, so a button works for tasks from other chats too.
      const merge = (Array.isArray(result.output.merge) ? result.output.merge.map(String) : [])
        .map((s) => bySlug.get(s)).filter((t): t is ProjectTask => !!t && t.status === "approved").map((t) => t.id);
      const retry = (Array.isArray(result.output.retry) ? result.output.retry : [])
        .map((r: any) => ({ task: bySlug.get(String(typeof r === "string" ? r : r?.slug)), worker: typeof r === "object" && r?.worker ? String(r.worker) : undefined }))
        .filter((r) => r.task && RETRYABLE.includes(r.task.status))
        .map((r) => {
          const w = r.worker ? this.pickAgent("worker", { teamId, name: r.worker }) : undefined;
          return { id: r.task!.id, worker_id: w && w.name.toLowerCase() === r.worker!.toLowerCase() ? w.id : undefined };
        });
      const notes = (Array.isArray(result.output.journal) ? result.output.journal : [])
        .map((n: unknown) => String(n).trim().slice(0, 400)).filter(Boolean).slice(0, 3);
      for (const n of notes) {
        this.db.prepare("INSERT INTO project_journal (project_id, chat_id, agent_id, text) VALUES (?, ?, ?, ?)").run(chat.project_id, chatId, planner.id, n);
      }
      const wiki = Array.isArray(result.output.wiki) ? result.output.wiki as { title?: string; section?: string; body?: string }[] : [];
      if (wiki.length) applyWikiWrites(this.db, chat.project_id, wiki);
      const msg = this.postMessage(chatId, "assistant", plan.reply, planner.id,
        plan.tasks.length || merge.length || retry.length || notes.length ? { ...plan, merge_ids: merge, retry, journal: notes } : undefined);
      for (const t of plan.tasks) {
        // A named developer if the planner chose one, otherwise the one with the fewest open tasks.
        const named = t.worker ? this.pickAgent("worker", { teamId, name: t.worker }) : undefined;
        const worker = named && named.name.toLowerCase() === t.worker!.toLowerCase() ? named : this.leastLoadedWorker(teamId);
        this.db.prepare(`INSERT INTO tasks (chat_id, project_id, message_id, slug, title, spec, paths, worker_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed')`)
          .run(chatId, chat.project_id, msg.id, t.slug, t.title, t.spec, JSON.stringify(t.paths ?? []), worker?.id ?? null);
      }
      for (const t of this.db.prepare("SELECT id FROM tasks WHERE message_id = ?").all(msg.id) as { id: number }[]) this.updateTask(t.id, {});
      if (plan.tasks.length && getSettings(this.db).auto_run_plans === "true") this.approvePlan(msg.id);
    } catch (err) {
      this.postMessage(chatId, "event", `Planning failed: ${(err as Error).message}`);
    } finally {
      this.planning.delete(chatId);
    }
  }

  leastLoadedWorker(teamId: number | null): AgentRow | undefined {
    const open = this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE worker_id = ?
      AND status IN ('proposed','queued','building','verifying','reviewing')`);
    return teamAgents(this.db, teamId, "worker")
      .map((a) => ({ a, n: (open.get(a.id) as { n: number }).n }))
      .sort((x, y) => x.n - y.n || x.a.id - y.a.id)[0]?.a;
  }

  approvePlan(messageId: number) {
    const rows = this.db.prepare("SELECT id FROM tasks WHERE message_id = ? AND status = 'proposed'").all(messageId) as { id: number }[];
    for (const r of rows) this.updateTask(r.id, { status: "queued" });
    this.tick();
    return rows.length;
  }

  // ---------- scheduling ----------

  tick() {
    const settings = getSettings(this.db);
    const maxParallel = Math.max(1, Number(settings.max_parallel) || 3);
    if (this.running.size >= maxParallel) return;
    const queued = this.db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY id").all() as TaskRow[];
    const sprintTasks = queued.some((q) => q.sprint_id)
      ? this.db.prepare("SELECT id, title, status, paths, sprint_id FROM tasks WHERE sprint_id IS NOT NULL").all() as { id: number; title: string; status: string; paths: string; sprint_id: number | null }[]
      : [];
    for (const t of queued) {
      if (this.running.size >= maxParallel) break;
      // Same files as an earlier task of the sprint: wait until that one has merged, then start from its result.
      // A task that was just started still says "queued" in the database for a moment: count it as working.
      const blocker = blockingTask(t, sprintTasks.map((o) => (this.running.has(o.id) && o.status === "queued" ? { ...o, status: "building" } : o)), (s) => json.parse<string[]>(s, []));
      if (blocker) {
        // Told once per blocker, and once more if it stops (a different message); not on every status change of the blocker.
        const stuck = isStuck(blocker.status);
        const key = waitKey(t.id, blocker);
        if (!this.budgetTold.has(key)) {
          this.budgetTold.add(key);
          this.postMessage(t.chat_id, "event", `**${t.title}** is waiting for **${blocker.title}**, which changes the same files${stuck ? ` and has stopped (${blocker.status.replace("_", " ")}). Retry or cancel it` : ""}.`);
        }
        continue;
      }
      // Over a spending limit: the task waits (it stays queued) and starts when the limit is raised or the day turns.
      const stop = overBudget(this.db, t.sprint_id);
      if (stop) {
        const key = `${t.id}:${stop.slice(0, 40)}:${new Date().toDateString()}`;
        if (!this.budgetTold.has(key)) { this.budgetTold.add(key); this.postMessage(t.chat_id, "event", `**${t.title}** is waiting. ${stop}`); }
        continue;
      }
      // One task per developer at a time: an agent has one desk.
      let worker = this.agent(t.worker_id);
      if (!worker || !worker.enabled) {
        worker = teamAgents(this.db, teamOfChat(this.db, t.chat_id), "worker").find((a) => !this.busyAgents.has(a.id));
        if (!worker) continue;
        this.db.prepare("UPDATE tasks SET worker_id = ? WHERE id = ?").run(worker.id, t.id);
      }
      if (this.busyAgents.has(worker.id) || this.isAgentReserved(worker.id)) continue;
      const ctrl = new AbortController();
      this.running.set(t.id, ctrl);
      this.busyAgents.add(worker.id);
      this.runTask(t.id, ctrl.signal).finally(() => {
        this.running.delete(t.id);
        if (t.sprint_id) void this.scrum?.settle(t.sprint_id);
        this.tick();
      });
    }
  }

  private isAgentReserved(agentId: number) {
    for (const id of this.running.keys()) if (this.task(id)?.worker_id === agentId) return true;
    return false;
  }

  cancel(taskId: number) {
    const ctrl = this.running.get(taskId);
    if (ctrl) ctrl.abort();
    const t = this.task(taskId);
    if (["proposed", "queued", "interrupted", "needs_attention", "failed", "approved"].includes(t.status) || ctrl) {
      this.updateTask(taskId, { status: "cancelled" });
      if (t.sprint_id) void this.scrum?.settle(t.sprint_id);
      this.tick(); // a task that waited for this one can start
    }
  }

  /** Runs a stopped task again, on its own branch; optionally with another developer. */
  retry(taskId: number, workerId?: number) {
    const t = this.task(taskId);
    if (!["interrupted", "failed", "needs_attention", "cancelled"].includes(t.status)) throw new Error(`Task is ${t.status}`);
    if (t.sprint_id) {
      const sp = this.db.prepare("SELECT number, status FROM sprints WHERE id = ?").get(t.sprint_id) as { number: number; status: string } | undefined;
      // The sprint branch is gone after the release: the work has to be planned again.
      if (sp?.status === "released") throw new Error(`Sprint ${sp.number} was already released. Plan the item again from the backlog.`);
      // A closed sprint that is not released yet can still take the work; keep the item from being planned twice meanwhile.
      if (sp?.status === "done" && t.item_id) {
        this.db.prepare("UPDATE backlog_items SET status = 'in_sprint', sprint_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'ready' AND sprint_id IS NULL").run(t.sprint_id, t.item_id);
      }
    }
    if (workerId) {
      const w = this.agent(workerId);
      if (!w || w.role !== "worker") throw new Error("Pick a developer agent");
      this.updateTask(taskId, { worker_id: workerId });
    }
    // Out of rounds: a retry is one more fix round with the last feedback. Otherwise the stopped round runs again.
    if (t.status === "needs_attention" && t.feedback) this.updateTask(taskId, { round: t.round + 1 });
    this.updateTask(taskId, { status: "queued", error: "" });
    this.tick();
  }

  // ---------- the pipeline ----------

  private async runTask(taskId: number, signal: AbortSignal) {
    let t = this.task(taskId);
    const project = this.project(t.project_id);
    const worker = this.agent(t.worker_id)!;
    const settings = getSettings(this.db);
    const maxRounds = Math.max(0, Number(settings.max_review_rounds) || 0);
    const verify = json.parse<string[]>(project.verify, []);
    const setup = json.parse<string[]>(project.setup, []);
    const paths = [...json.parse<string[]>(t.paths, []), ...json.parse<string[]>(project.allowed_paths, [])];
    const shell = (project.shell || "auto") as ShellKind;
    const say = (text: string, agentId?: number) => this.postMessage(t.chat_id, "event", text, agentId);

    try {
      await ensureProjectCheckout(project);
      const remote = await projectHasRemote(project);
      // A sprint task starts from, is reviewed against and merges into its sprint branch.
      const sprint = t.sprint_id ? this.db.prepare("SELECT * FROM sprints WHERE id = ?").get(t.sprint_id) as { id: number; branch: string; number: number } | undefined : undefined;
      const { wt, branch } = await ensureWorktree(project, join(this.dataDir, "worktrees"), t.slug, false, sprint?.branch);
      t = this.updateTask(taskId, { branch, worktree: wt, status: "building" });
      if (sprint) await syncBranch(wt, sprint.branch);

      for (const cmd of setup) {
        this.log(taskId, `$ ${cmd}`);
        const r = await runCommandLine(cmd, shell, { cwd: wt, timeoutMs: 20 * 60_000, signal, onLine: (l) => this.log(taskId, l) });
        if (r.code !== 0) throw new Error(`Setup failed: ${cmd}\n${tail(r.stderr || r.stdout, 15)}`);
      }

      let feedback = t.round > 0 ? t.feedback : "";
      // What the task did, from the rounds that changed files: a later round that changes nothing must not replace it.
      let delivered = t.round > 0 || t.commit_sha ? t.summary : "";
      for (let round = t.round; ; round++) {
        if (signal.aborted) return;
        t = this.updateTask(taskId, { status: "building", round });
        say(round === 0 ? `${worker.name} started **${t.title}**` : `${worker.name} works on review round ${round + 1} of **${t.title}**`, worker.id);

        const prompt = buildWorkerPrompt({ title: t.title, spec: t.spec, branch, round, feedback, paths, verify, envForChecks: !!project.checks_env_file });
        const built = await this.callAgent({ agent: worker, kind: "build", chatId: t.chat_id, taskId, round, cwd: wt, prompt, mode: "write", signal });
        if (signal.aborted) return;
        if (!built.ok) throw new Error(`${worker.name} did not finish: ${built.error ?? "unknown error"}`);
        this.updateTask(taskId, { summary: built.summary });

        const commit = await commitChanges(wt, `${t.title}${round ? ` (round ${round + 1})` : ""}\n\n${built.summary.slice(0, 2000)}`, paths);
        if (commit.outside.length) {
          throw new Error(`Changed files outside the allowed paths, nothing committed: ${commit.outside.join(", ")}`);
        }
        if (!commit.committed && round === 0) {
          // A restarted task has its earlier work on the branch already: finding nothing left to do is fine then.
          const have = await diffAgainstBase(wt, sprint ? sprint.branch : project.base_branch, sprint ? false : remote).catch(() => "");
          if (!have.trim()) throw new Error("The worker made no changes");
        }
        if (commit.committed) delivered = delivered && round > 0 ? `${delivered}\n\nRound ${round + 1}: ${built.summary.slice(0, 1500)}` : built.summary.slice(0, 3000);
        const summary = delivered || built.summary;
        this.updateTask(taskId, { summary });
        this.updateTask(taskId, { commit_sha: await headSha(wt) });

        // Verify: every command must pass.
        this.updateTask(taskId, { status: "verifying" });
        this.activity(worker.id, "waiting", "running checks", taskId, t.chat_id);
        let failure = "", setupIssue: string | undefined;
        if (verify.length) ({ failure, setupProblem: setupIssue } = await this.runChecks(taskId, t.chat_id, worker, round, verify, shell, wt, signal, project));
        this.activity(worker.id, "idle");
        if (signal.aborted) return;
        if (failure && setupIssue) {
          // Nothing the developer changes in the code can fix this: stop now instead of spending more rounds.
          const error = `A check cannot pass because of the project setup, not the code: ${setupIssue}\n\n${failure}\n\nFix it in the project settings (Verify, Setup or Env file for checks), then press Retry.`;
          this.updateTask(taskId, { status: "needs_attention", error, feedback: "" });
          say(`Checks cannot pass on **${t.title}**: ${setupIssue} This is a project setup problem, so it was not sent back to ${worker.name}. Fix it in the project settings and press Retry.`);
          return;
        }
        if (failure) {
          feedback = `## Verify failed\n${failure}\nFix the cause; do not weaken or skip the check.`;
          if (round >= maxRounds) {
            this.updateTask(taskId, { status: "needs_attention", error: failure, feedback });
            say(`Checks failed on **${t.title}** and no rounds are left:\n${failure}`);
            return;
          }
          this.updateTask(taskId, { feedback });
          say(`Checks failed on **${t.title}**; sending it back to ${worker.name}.`);
          continue;
        }

        // Review.
        const reviewer = this.pickAgent("reviewer", { teamId: teamOfChat(this.db, t.chat_id), preferred: t.reviewer_id });
        if (!reviewer) {
          await this.finishApproved(project, t, wt, branch, summary, "(no reviewer agent configured)", sprint?.id);
          return;
        }
        this.updateTask(taskId, { status: "reviewing", reviewer_id: reviewer.id });
        const base = sprint ? sprint.branch : remote ? `origin/${project.base_branch}` : project.base_branch;
        const diffStat = await diffAgainstBase(wt, sprint ? sprint.branch : project.base_branch, sprint ? false : remote);
        const specs = t.spec + (feedback ? `\n\n### Round ${round + 1} feedback\n${feedback}` : "");
        const reviewed = await this.callAgent({
          agent: reviewer, kind: "review", chatId: t.chat_id, taskId, round, cwd: wt, mode: "read", output: REVIEW_TOOL, signal,
          prompt: buildReviewPrompt({ title: t.title, specs, branch, base, diffStat, verify }),
        });
        if (signal.aborted) return;
        if (!reviewed.ok || !reviewed.output) throw new Error(`Review by ${reviewer.name} failed: ${reviewed.error ?? "no verdict"}`);
        const verdict = String(reviewed.output.verdict) === "approve" ? "approve" : "changes";
        const reviewText = String(reviewed.output.review ?? "");
        const fixes = (reviewed.output.fixes as string[] | undefined) ?? [];
        this.updateTask(taskId, { verdict, review: reviewText });
        say(`${reviewer.name} reviewed **${t.title}**: **${verdict}**\n\n${reviewText}${fixes.length ? `\n\n**Fixes**\n${fixes.map((f) => `- ${f}`).join("\n")}` : ""}`, reviewer.id);

        if (verdict === "approve") {
          this.updateTask(taskId, { feedback: "" });
          await this.finishApproved(project, this.task(taskId), wt, branch, summary, reviewText, sprint?.id);
          return;
        }
        feedback = `## Review round ${round + 1} (${reviewer.name})\n${fixes.length ? fixes.map((f) => `- ${f}`).join("\n") : reviewText}`;
        if (round >= maxRounds) {
          this.updateTask(taskId, { status: "needs_attention", error: "Reviewer still asks for changes after the last round", feedback });
          return;
        }
        this.updateTask(taskId, { feedback });
      }
    } catch (err) {
      if (signal.aborted) return;
      const message = String((err as Error).message ?? err);
      this.updateTask(taskId, { status: "failed", error: message });
      say(`**${t.title}** failed: ${message}`);
      this.activity(worker.id, "error", message.slice(0, 60), taskId, t.chat_id);
      setTimeout(() => this.activity(worker.id, "idle"), 8000);
    }
  }

  // ---------- approvals ----------

  /** Pauses the run until the user allows or denies the command (or the task is stopped). */
  private askUser(q: { command: string; cwd: string; runId: number; taskId?: number; chatId?: number; agent: AgentRow; signal?: AbortSignal }) {
    const info = this.db.prepare(`INSERT INTO approvals (task_id, run_id, chat_id, agent_id, kind, request, cwd) VALUES (?, ?, ?, ?, 'command', ?, ?)`)
      .run(q.taskId ?? null, q.runId, q.chatId ?? null, q.agent.id, q.command, q.cwd);
    const id = Number(info.lastInsertRowid);
    this.activity(q.agent.id, "waiting", "needs your OK", q.taskId, q.chatId);
    bus.publish({ type: "approval", approval: this.approval(id) });
    return new Promise<{ allowed: boolean; by?: string }>((resolve) => {
      const finish = (answer: { allowed: boolean; by?: string }) => {
        this.pendingApprovals.delete(id);
        this.activity(q.agent.id, answer.allowed ? "running" : "thinking", answer.allowed ? q.command.slice(0, 60) : "carrying on without it", q.taskId, q.chatId);
        resolve(answer);
      };
      this.pendingApprovals.set(id, finish);
      q.signal?.addEventListener("abort", () => {
        if (!this.pendingApprovals.has(id)) return;
        this.db.prepare("UPDATE approvals SET status = 'expired', decided_at = datetime('now') WHERE id = ?").run(id);
        bus.publish({ type: "approval", approval: this.approval(id) });
        finish({ allowed: false, by: "stopped" });
      }, { once: true });
    });
  }

  approval(id: number) {
    return this.db.prepare(`SELECT ap.*, a.name AS agent, t.title AS task, c.title AS chat, p.name AS project
      FROM approvals ap LEFT JOIN agents a ON a.id = ap.agent_id LEFT JOIN tasks t ON t.id = ap.task_id
      LEFT JOIN chats c ON c.id = ap.chat_id LEFT JOIN projects p ON p.id = c.project_id WHERE ap.id = ?`).get(id) as Record<string, unknown> | undefined;
  }

  /**
   * The user's answer. "always" adds a rule to the agent's allowed list: the given prefix (all commands that start
   * with it) or the exact command. Commands with pipes or redirects can only be allowed once.
   */
  decide(id: number, d: { allow: boolean; always?: boolean; prefix?: string; by: string }) {
    const row = this.approval(id);
    if (!row) throw new Error("Not found");
    if (row.status !== "pending") throw new Error(`Already ${row.status}`);
    const resolve = this.pendingApprovals.get(id);
    let rule = "";
    if (d.allow && d.always) {
      const command = String(row.request);
      if (/[|><`]|\$\(/.test(command)) throw new Error("Commands with pipes, redirects or $( ) can only be allowed once");
      const prefix = (d.prefix ?? command).trim();
      if (!prefix || !command.startsWith(prefix)) throw new Error("The rule must be the start of the command");
      rule = prefix === command ? `Bash(${prefix})` : `Bash(${prefix}:*)`;
      const agent = this.agent(Number(row.agent_id));
      if (agent) {
        const list = json.parse<string[]>(agent.allowed_tools, []);
        const base = list.length ? list : agent.role === "worker" ? [...DEFAULT_WORKER_TOOLS] : [];
        if (!base.includes(rule)) base.push(rule);
        this.db.prepare("UPDATE agents SET allowed_tools = ? WHERE id = ?").run(JSON.stringify(base), agent.id);
      }
    }
    this.db.prepare("UPDATE approvals SET status = ?, decided_by = ?, rule = ?, decided_at = datetime('now') WHERE id = ?")
      .run(d.allow ? "allowed" : "denied", d.by, rule, id);
    bus.publish({ type: "approval", approval: this.approval(id) });
    // No waiting run (server restarted): the decision is recorded, the rule still applies next time.
    resolve?.({ allowed: d.allow, by: d.by });
    return this.approval(id);
  }

  /**
   * Runs the verify commands as a "checks" run, so they show in the task's Activity like an agent call.
   * The project's env file (if set) is in the worktree only while they run. `setupProblem` is set when the failure is the
   * project's setup (missing script, command, environment variable), which no code change fixes.
   */
  private async runChecks(taskId: number, chatId: number, worker: AgentRow, round: number, verify: string[], shell: ShellKind, wt: string, signal: AbortSignal, project: ProjectRow) {
    const runId = this.startRun({ taskId, chatId, agent: worker, kind: "checks", round, model: "", engine: "shell" });
    const t0 = Date.now();
    const transcript: TranscriptEntry[] = [];
    let failure = "", setupIssue: string | undefined, stopped = false;
    let envFile: EnvFileHandle = { note: "", cleanup: () => {} };
    try {
      envFile = placeEnvFile(project.path, wt, project.checks_env_file ?? "", project.checks_env_target || ".env");
      if (envFile.note) this.log(taskId, envFile.note);
      for (const cmd of verify) {
        this.log(taskId, `$ ${cmd}`);
        const started = Date.now();
        const r = await runCommandLine(cmd, shell, { cwd: wt, timeoutMs: 30 * 60_000, signal, onLine: (l) => this.log(taskId, l) });
        const out = tail(`${r.stdout}\n${r.stderr}`, 80);
        // Stop pressed while it ran: the command was ended by us, so it did not fail and says nothing about the code.
        const cut = signal.aborted && r.code !== 0;
        const entry: TranscriptEntry = { t: started - t0, kind: "tool", tool: "command", input: cmd, output: `exit ${r.code}${r.timedOut ? " (timed out)" : ""}${cut ? " (stopped)" : ""}\n${out}`, isError: r.code !== 0, ms: Date.now() - started };
        transcript.push(entry);
        this.step(runId, taskId, entry);
        if (cut) { stopped = true; break; }
        if (r.code !== 0) {
          failure = `\`${cmd}\` failed (exit ${r.code}):\n\`\`\`\n${tail(`${r.stdout}\n${r.stderr}`, 40)}\n\`\`\``;
          setupIssue = setupProblem(`${r.stdout}\n${r.stderr}`);
          break;
        }
      }
    } catch (err) {
      // The env file could not be placed: a project setting problem, not the developer's.
      failure = (err as Error).message;
      setupIssue = failure;
      const entry: TranscriptEntry = { t: Date.now() - t0, kind: "error", text: failure, isError: true };
      transcript.push(entry);
      this.step(runId, taskId, entry);
    } finally {
      envFile.cleanup();
    }
    this.endRun(runId, { ok: !failure && !stopped, summary: stopped ? "Stopped while the checks were running" : failure ? "A check failed" : "All checks passed", turns: transcript.length, costUsd: null,
      tokensIn: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0, seconds: Math.round((Date.now() - t0) / 1000), transcript }, []);
    return { failure, setupProblem: setupIssue };
  }

  /** Approved in a sprint: no pull request; the work merges into the sprint branch, one task at a time. */
  private async mergeIntoSprint(project: ProjectRow, t: TaskRow, sprintId: number, summary: string) {
    const sprint = this.db.prepare("SELECT * FROM sprints WHERE id = ?").get(sprintId) as { branch: string };
    const run = async () => {
      const swt = await ensureSprintWorktree(project, join(this.dataDir, "worktrees"), sprintId, sprint.branch);
      const r = await squashInto(swt, t.branch, `${t.title}\n\n${summary.slice(0, 3000)}`);
      if (!r.ok) {
        this.updateTask(t.id, { status: "needs_attention", error: `Conflicts with work already in the sprint branch: ${r.conflicts.join(", ")}. Retry it after the other tasks are done.` });
        this.postMessage(t.chat_id, "event", `**${t.title}** conflicts with the sprint branch (${r.conflicts.join(", ")}). Retry it once the other tasks have merged.`);
        return;
      }
      await removeWorktree(project, t.worktree, t.branch, true);
      this.updateTask(t.id, { status: "merged", worktree: "" });
      if (t.item_id) this.db.prepare("UPDATE backlog_items SET status = 'done', sprint_id = ?, updated_at = datetime('now') WHERE id = ?").run(sprintId, t.item_id);
      this.postMessage(t.chat_id, "event", `**${t.title}** passed QA and is merged into the sprint branch \`${sprint.branch}\`.`);
      void this.scrum?.mergedLate(sprintId, t.title);
    };
    const prev = this.sprintMerges.get(sprintId) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.sprintMerges.set(sprintId, next.catch(() => {}));
    await next;
  }

  private async finishApproved(project: ProjectRow, t: TaskRow, wt: string, branch: string, summary: string, review: string, sprintId?: number) {
    if (sprintId) return this.mergeIntoSprint(project, t, sprintId, summary);
    let pr = t.pr_url;
    if (getSettings(this.db).push_and_pr === "true" && process.env.AGENTDESK_DEMO !== "1") {
      try {
        const body = `${summary}\n\n---\n**Review**\n\n${review}\n\nCost $${t.cost_usd.toFixed(2)} · ${(t.tokens / 1e6).toFixed(1)}M tokens`;
        pr = pr ? (await prComment(project, wt, branch, body), pr) : await pushAndOpenPr(project, wt, branch, t.title, body);
      } catch (err) {
        this.postMessage(t.chat_id, "event", `Push / PR for **${t.title}** failed: ${(err as Error).message}`);
      }
    }
    this.updateTask(t.id, { status: "approved", pr_url: pr || "" });
    this.postMessage(t.chat_id, "event", `**${t.title}** is ready to merge${pr ? ` · [pull request](${pr})` : ""}.`);
  }

  async merge(taskId: number): Promise<string> {
    const t = this.task(taskId);
    if (t.status !== "approved") throw new Error(`Task is ${t.status}, not approved`);
    const project = this.project(t.project_id);
    const msg = `${t.title}\n\n${t.summary.slice(0, 3000)}\n\nCost: $${t.cost_usd.toFixed(2)}, ${t.tokens} tokens`;
    const result = await mergeTask(project, t.worktree, t.branch, msg);
    if (!result.startsWith("Complete")) this.updateTask(taskId, { status: "merged" });
    this.postMessage(t.chat_id, "event", `**${t.title}**: ${result}.`);
    return result;
  }

  async discard(taskId: number) {
    const t = this.task(taskId);
    if (this.running.has(taskId)) throw new Error("Stop the task first");
    // Discard = the branch is gone: local worktree and branch, and the pushed branch (an open PR closes with it).
    if (t.branch) await removeWorktree(this.project(t.project_id), t.worktree, t.branch, true, true);
    this.updateTask(taskId, { status: "cancelled", worktree: "" });
  }

  /** Reads a repository with the planner (read-only) and drafts the project notes every agent gets. */
  async draftProjectNotes(path: string): Promise<string> {
    const projectId = (this.db.prepare("SELECT id FROM projects WHERE path = ?").get(path) as { id: number } | undefined)?.id;
    const planner = pickPlanner(this.db, { projectId });
    if (!planner) throw new Error("Create a planner agent first; it writes the draft.");
    const r = await this.callAgent({
      agent: planner, kind: "notes", cwd: path, mode: "read", output: NOTES_TOOL,
      projectId,
      prompt: `Read this repository and write short project notes for AI developer agents that will work in it.
Cover, in Markdown, under 60 lines: what the project is (2 lines), a code map (folder/file → what lives there),
how to build, run and test it (exact commands), conventions to follow, and things not to touch (secrets, generated files).
Only state what you saw in the files; say "unknown" where you could not find something.`,
    });
    if (!r.ok || !r.output) throw new Error(r.error ?? "No notes returned");
    return String(r.output.notes ?? "");
  }

  activeTaskIds() {
    return [...this.running.keys()];
  }
}

function firstLine(text: string) {
  return (text || "").split(/\r?\n/).find((l) => l.trim())?.slice(0, 80) ?? "";
}

type PlanTask = { slug: string; title: string; spec: string; paths?: string[]; worker?: string };

export function normalizePlan(raw: Record<string, unknown>, existing: string[]): { reply: string; tasks: PlanTask[] } {
  const used = new Set(existing);
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).slice(0, 12).map((t: any, i: number) => {
    let slug = String(t.slug || t.title || `task-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `task-${i + 1}`;
    const base = slug;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return {
      slug, title: String(t.title || slug), spec: String(t.spec || ""),
      paths: Array.isArray(t.paths) ? t.paths.map(String) : [], worker: t.worker ? String(t.worker) : undefined,
    };
  }).filter((t) => t.spec.trim());
  return { reply: String(raw.reply ?? ""), tasks };
}
