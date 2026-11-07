import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { getSettings, json } from "./db.ts";
import { bus } from "./bus.ts";
import type { Orchestrator, TaskRow } from "./orchestrator/orchestrator.ts";
import { architectOf, securityOf, teamAgents, teamOfChat, teamOfProject, pickAgent } from "./teams.ts";
import {
  ensureProjectCheckout, createSprintBranch, ensureSprintWorktree, diffAgainstBase, projectHasRemote, branchLog, releaseSprint,
  removeWorktree, deleteBranch, type ProjectRow,
} from "./orchestrator/git.ts";
import {
  SCRUM_TOOL, ARCHITECT_TOOL, ESTIMATE_TOOL, SECURITY_TOOL, NOTES_TOOL, buildSecurityPrompt,
} from "./orchestrator/prompts.ts";

/**
 * The Scrum process of a project.
 *
 *   request (chat) → PM drafts the item → architect adds technical notes → a developer estimates → READY
 *   you set the priority → the Scrum master starts a sprint: ready items by priority up to the team's capacity
 *   each item becomes a task: build → checks → QA review, then it merges into the sprint branch
 *   all merged → release notes → (optional) security review → Release = merge the sprint branch into the base branch + push
 *
 * PIs are optional: a goal that groups sprints, so notes and token usage roll up.
 */
export type ItemStatus = "refining" | "ready" | "in_sprint" | "done" | "dropped" | "error";
export type Item = {
  id: number; project_id: number; sprint_id: number | null; chat_id: number | null; title: string; request: string; story: string;
  acceptance: string; tech_notes: string; paths: string; worker: string; points: number | null; priority: number; status: ItemStatus;
  step: string; error: string; created_at: string; updated_at: string;
};
export type Sprint = {
  id: number; project_id: number; pi_id: number | null; chat_id: number | null; number: number; name: string; goal: string;
  status: "planning" | "active" | "done" | "released"; branch: string; capacity: number; release_notes: string;
  security_verdict: string; security_report: string; created_at: string; started_at: string | null; finished_at: string | null; released_at: string | null;
};
type Pi = { id: number; project_id: number; name: string; goal: string; status: "active" | "closed"; created_at: string };

const SIZES = [1, 2, 3, 5, 8, 13];
const TERMINAL = ["merged", "cancelled"];
const RUNNING = ["proposed", "queued", "building", "verifying", "reviewing"];
const slugify = (s: string, n: number) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, n) || "item";
const firstLine = (t: string) => (t || "").split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 100) ?? "";

class Failure extends Error { constructor(msg: string, public status = 400) { super(msg); } }

export class Scrum {
  /** Refinement runs one item at a time per project (agents are shared and calls cost money). */
  private queues = new Map<number, Promise<unknown>>();
  private working = new Set<string>();
  private stalled = new Set<number>();

  constructor(private db: DB, private orch: Orchestrator) {}

  // ---------- helpers ----------

  private project(id: number): ProjectRow & { process: string; points_per_dev: number } {
    const p = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as (ProjectRow & { process: string; points_per_dev: number }) | undefined;
    if (!p) throw new Failure("Project not found", 404);
    return p;
  }
  item(id: number) {
    const i = this.db.prepare("SELECT * FROM backlog_items WHERE id = ?").get(id) as Item | undefined;
    if (!i) throw new Failure("Backlog item not found", 404);
    return i;
  }
  sprint(id: number) {
    const s = this.db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Sprint | undefined;
    if (!s) throw new Failure("Sprint not found", 404);
    return s;
  }
  private teamOf(projectId: number) { return teamOfProject(this.db, projectId); }
  private changed(projectId: number) { bus.publish({ type: "scrum", projectId }); }

  /** A chat to tell the user in: the item's own chat, else the project's newest. */
  private say(projectId: number, chatId: number | null | undefined, text: string, agentId?: number) {
    const own = chatId ? this.db.prepare("SELECT id FROM chats WHERE id = ? AND project_id = ?").get(chatId, projectId) as { id: number } | undefined : undefined;
    const id = own?.id ?? (this.db.prepare("SELECT id FROM chats WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId) as { id: number } | undefined)?.id;
    if (id) this.orch.postMessage(id, "event", text, agentId);
  }

  private developers(projectId: number) { return teamAgents(this.db, this.teamOf(projectId), "worker"); }

  /** Capacity of a sprint: the developers of the team times the points one developer does per sprint. */
  capacity(projectId: number) {
    const p = this.project(projectId);
    const developers = Math.max(1, this.developers(projectId).length);
    return { developers, points_per_dev: p.points_per_dev, capacity: developers * p.points_per_dev };
  }

  // ---------- where the cycle is ----------

  cycle(projectId: number) {
    const count = (sql: string) => (this.db.prepare(sql).get(projectId) as { n: number }).n;
    const active = this.db.prepare("SELECT * FROM sprints WHERE project_id = ? AND status = 'active'").get(projectId) as Sprint | undefined;
    const done = this.db.prepare("SELECT * FROM sprints WHERE project_id = ? AND status = 'done' ORDER BY number DESC").get(projectId) as Sprint | undefined;
    const planning = this.db.prepare("SELECT * FROM sprints WHERE project_id = ? AND status = 'planning' ORDER BY number").get(projectId) as Sprint | undefined;
    const refining = count("SELECT COUNT(*) AS n FROM backlog_items WHERE project_id = ? AND status = 'refining'");
    const ready = count("SELECT COUNT(*) AS n FROM backlog_items WHERE project_id = ? AND status = 'ready' AND sprint_id IS NULL");
    const items = count("SELECT COUNT(*) AS n FROM backlog_items WHERE project_id = ? AND status != 'dropped'");
    if (active) {
      const t = this.db.prepare("SELECT COUNT(*) AS n, SUM(status = 'merged') AS merged FROM tasks WHERE sprint_id = ?").get(active.id) as { n: number; merged: number | null };
      return { step: "sprint", text: `Sprint ${active.number} "${active.name}" is running: ${t.merged ?? 0} of ${t.n} items merged.`, sprint_id: active.id };
    }
    if (done) return { step: "release", text: `Sprint ${done.number} "${done.name}" is complete. Next: optional security review, then Release.`, sprint_id: done.id };
    if (refining) return { step: "refine", text: `${refining} backlog item${refining > 1 ? "s are" : " is"} being refined (architect notes, estimate).`, sprint_id: null };
    if (ready) return { step: "plan", text: `${ready} item${ready > 1 ? "s are" : " is"} ready. Next: set priorities and start ${planning ? `sprint ${planning.number}` : "a sprint"}.`, sprint_id: planning?.id ?? null };
    if (!items) return { step: "start", text: "Empty backlog. Next: create a PI or a sprint, and describe what the business owners need.", sprint_id: null };
    return { step: "plan", text: "No item is ready yet.", sprint_id: planning?.id ?? null };
  }

  // ---------- the chat ----------

  /** A message in a Scrum project's chat: the product manager answers and turns requests into backlog items. */
  async chat(chatId: number) {
    const chat = this.db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as { id: number; project_id: number };
    const teamId = teamOfChat(this.db, chatId);
    const pm = pickAgent(this.db, "planner", { teamId });
    if (!pm) {
      this.orch.postMessage(chatId, "event", "The team has no planner to act as product manager. Add one under Teams.");
      return;
    }
    try {
      const project = this.project(chat.project_id);
      await ensureProjectCheckout(project);
      const history = (this.db.prepare(`SELECT m.id, m.role, m.content,
          (SELECT GROUP_CONCAT(a.name, ', ') FROM attachments a WHERE a.message_id = m.id) AS files
        FROM messages m WHERE m.chat_id = ? AND m.role != 'event' ORDER BY m.id DESC LIMIT 20`)
        .all(chatId) as { id: number; role: string; content: string; files: string | null }[]).reverse();
      const prompt = `# Conversation
${history.map((m) => `## ${m.role === "user" ? "Business owner" : "You (earlier)"}\n${m.content}${m.files ? `\n(attached: ${m.files})` : ""}`).join("\n\n")}

${this.stateText(project.id)}

# Your job
You are the product manager of a Scrum team. The people writing to you are the business owners.
- A new request for something to be built or changed: write backlog items (title, user story, testable acceptance criteria).
  One request can be several items when it has separable parts. Do not write technical solutions: the architect does that next.
- Whatever step the cycle is at, the business owner can add items. Do not repeat items that already exist in the backlog.
- "Review the backlog": say what you see in \`reply\`: duplicates, gaps, unclear acceptance criteria, a suggested priority order. Create no items.
- Create a PI (program increment: a goal over several sprints) or a sprint only when asked, with a short name and goal.
- Refinement (architect notes, developer estimate) starts by itself for every item you create. The Scrum master starts sprints from
  the Sprints page by priority and team capacity; tell the user to press Start there when they ask for it.
Answer briefly. Use the business owner's words.`;
      const r = await this.orch.callAgent({ agent: pm, kind: "backlog", chatId, cwd: project.path, prompt, mode: "read", output: SCRUM_TOOL });
      if (!r.ok || !r.output) {
        this.orch.postMessage(chatId, "event", `Product manager ${pm.name} failed: ${r.error ?? "no answer returned"}`, pm.id);
        return;
      }
      const out = r.output as { reply?: unknown; items?: any[]; pi?: any; sprint?: any };
      const made: string[] = [];
      if (out.pi?.name) { const pi = this.createPi(project.id, String(out.pi.name), String(out.pi.goal ?? "")); made.push(`PI **${pi.name}**`); }
      if (out.sprint?.name) { const s = this.createSprint(project.id, String(out.sprint.name), String(out.sprint.goal ?? "")); made.push(`sprint ${s.number} **${s.name}**`); }
      const created = this.addItems(project.id, Array.isArray(out.items) ? out.items : [], chatId);
      for (const i of created) made.push(`item **${i.title}**`);
      this.orch.postMessage(chatId, "assistant", String(out.reply ?? "").trim() || (made.length ? "Done." : "Noted."), pm.id);
      if (made.length) this.orch.postMessage(chatId, "event", `Created ${made.join(", ")}.${created.length ? " The architect and a developer refine the new items next." : ""}`);
    } catch (err) {
      this.orch.postMessage(chatId, "event", `Product manager could not answer: ${(err as Error).message}`);
    }
  }

  /** What the product manager (and the UI) see of the current cycle. */
  stateText(projectId: number) {
    const cyc = this.cycle(projectId);
    const pis = this.db.prepare("SELECT * FROM pis WHERE project_id = ? AND status = 'active' ORDER BY id").all(projectId) as Pi[];
    const sprints = this.db.prepare("SELECT * FROM sprints WHERE project_id = ? AND status != 'released' ORDER BY number").all(projectId) as Sprint[];
    const items = this.db.prepare("SELECT * FROM backlog_items WHERE project_id = ? AND status NOT IN ('dropped') ORDER BY priority, id LIMIT 60").all(projectId) as Item[];
    const cap = this.capacity(projectId);
    return `# Scrum state
Current step: ${cyc.text}
Sprint capacity: ${cap.capacity} points (${cap.developers} developer${cap.developers > 1 ? "s" : ""} × ${cap.points_per_dev}).
PIs: ${pis.map((p) => `"${p.name}" (${p.goal || "no goal"})`).join("; ") || "none"}.
Sprints not released: ${sprints.map((s) => `${s.number} "${s.name}" [${s.status}]`).join("; ") || "none"}.
Backlog by priority:
${items.map((i) => `- #${i.id} [${i.status}${i.points ? `, ${i.points} pts` : ""}${i.sprint_id ? `, sprint ${this.sprint(i.sprint_id).number}` : ""}] ${i.title}`).join("\n") || "(empty)"}`;
  }

  // ---------- PIs and sprints ----------

  createPi(projectId: number, name: string, goal = "") {
    name = name.trim().slice(0, 80);
    if (!name) throw new Failure("A PI needs a name");
    const id = Number(this.db.prepare("INSERT INTO pis (project_id, name, goal) VALUES (?, ?, ?)").run(projectId, name, goal.slice(0, 600)).lastInsertRowid);
    this.changed(projectId);
    return this.db.prepare("SELECT * FROM pis WHERE id = ?").get(id) as Pi;
  }

  /** A planned sprint (not started), in the active PI if there is one. Its own chat carries the progress messages. */
  createSprint(projectId: number, name: string, goal = "", piId?: number | null) {
    name = name.trim().slice(0, 80);
    if (!name) throw new Failure("A sprint needs a name");
    const number = ((this.db.prepare("SELECT MAX(number) AS n FROM sprints WHERE project_id = ?").get(projectId) as { n: number | null }).n ?? 0) + 1;
    const pi = piId === undefined
      ? (this.db.prepare("SELECT id FROM pis WHERE project_id = ? AND status = 'active' ORDER BY id DESC").get(projectId) as { id: number } | undefined)?.id ?? null
      : piId;
    const chat = Number(this.db.prepare("INSERT INTO chats (project_id, title) VALUES (?, ?)").run(projectId, `Sprint ${number}: ${name}`.slice(0, 80)).lastInsertRowid);
    const id = Number(this.db.prepare("INSERT INTO sprints (project_id, pi_id, chat_id, number, name, goal) VALUES (?, ?, ?, ?, ?, ?)")
      .run(projectId, pi, chat, number, name, goal.slice(0, 600)).lastInsertRowid);
    this.changed(projectId);
    return this.sprint(id);
  }

  // ---------- backlog ----------

  addItems(projectId: number, raw: any[], chatId?: number | null) {
    const existing = (this.db.prepare("SELECT title FROM backlog_items WHERE project_id = ? AND status != 'dropped'").all(projectId) as { title: string }[]).map((r) => r.title.toLowerCase());
    const out: Item[] = [];
    for (const r of raw.slice(0, 10)) {
      const title = String(r?.title ?? "").trim().slice(0, 120);
      if (!title || existing.includes(title.toLowerCase())) continue;
      existing.push(title.toLowerCase());
      out.push(this.addItem(projectId, { title, request: r.request, story: r.story, acceptance: r.acceptance }, chatId));
    }
    return out;
  }

  /** A new backlog item goes to the end of the list and straight into refinement: only the missing parts are written. */
  addItem(projectId: number, f: { title: string; request?: unknown; story?: unknown; acceptance?: unknown }, chatId?: number | null) {
    this.project(projectId);
    const last = (this.db.prepare("SELECT MAX(priority) AS p FROM backlog_items WHERE project_id = ?").get(projectId) as { p: number | null }).p ?? 0;
    const story = String(f.story ?? "").trim();
    const id = Number(this.db.prepare(`INSERT INTO backlog_items (project_id, chat_id, title, request, story, acceptance, priority, status, step)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'refining', ?)`)
      .run(projectId, chatId ?? null, String(f.title).trim().slice(0, 120), String(f.request ?? "").slice(0, 4000), story.slice(0, 4000),
        String(f.acceptance ?? "").slice(0, 4000), last + 1, story ? "architect" : "product").lastInsertRowid);
    this.changed(projectId);
    this.refine(id);
    return this.item(id);
  }

  /** Runs the refinement of one item behind the others of its project. */
  refine(itemId: number) {
    const item = this.item(itemId);
    const key = `refine:${itemId}`;
    if (this.working.has(key)) return;
    this.working.add(key);
    const prev = this.queues.get(item.project_id) ?? Promise.resolve();
    const next = prev.then(() => this.runRefine(itemId)).catch(() => {}).finally(() => this.working.delete(key));
    this.queues.set(item.project_id, next);
  }

  private async runRefine(itemId: number) {
    let item = this.item(itemId);
    if (item.status !== "refining") return;
    const project = this.project(item.project_id);
    const teamId = this.teamOf(project.id);
    const set = (f: Partial<Item>) => {
      const keys = Object.keys(f);
      this.db.prepare(`UPDATE backlog_items SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`).run({ ...f, id: itemId } as any);
      this.changed(project.id);
      item = this.item(itemId);
    };
    const call = (agent: any, kind: string, prompt: string, output: any) =>
      this.orch.callAgent({ agent, kind, chatId: item.chat_id && this.chatInProject(item.chat_id, project.id) ? item.chat_id : undefined, projectId: project.id, itemId, cwd: project.path, prompt, mode: "read", output });
    try {
      await ensureProjectCheckout(project);
      // 1. Product manager: the story and acceptance criteria, unless the item came with them.
      if (!item.story.trim()) {
        const pm = pickAgent(this.db, "planner", { teamId });
        if (!pm) throw new Error("The team has no planner (product manager)");
        set({ step: "product" });
        const r = await call(pm, "backlog", `# Write one backlog item
Business owner's request:
${item.request || item.title}

Title so far: ${item.title}
Write the user story and testable acceptance criteria for this one item in \`items\` (exactly one entry). No technical solution. Leave \`reply\` short.`, SCRUM_TOOL);
        const draft = (r.output as any)?.items?.[0];
        if (!r.ok || !draft?.story) throw new Error(`Product manager ${pm.name}: ${r.error ?? "no story returned"}`);
        set({ story: String(draft.story).slice(0, 4000), acceptance: String(draft.acceptance ?? "").slice(0, 4000) });
      }
      // 2. Architect: how to build it, which files, who is best placed.
      if (!item.tech_notes.trim()) {
        const arch = architectOf(this.db, teamId);
        if (!arch) throw new Error("The team has no architect (a planner agent)");
        set({ step: "architect" });
        const devs = this.developers(project.id);
        const verify = json.parse<string[]>(project.verify, []);
        const r = await call(arch, "refine", `# Technical notes for a backlog item
## ${item.title}
${item.story}

### Acceptance criteria
${item.acceptance || "(none written)"}

# Team
Developers: ${devs.map((d) => `${d.name} (${firstLine(d.context.replace(/^\s*Specialty:\s*/im, "")) || "developer"})`).join("; ") || "(none yet)"}.
Verify commands run after every task: ${verify.join(" ; ") || "(none set)"}.
You are in the project folder (read-only for you). Base branch: ${project.base_branch}.

Read the code you need, then write the technical notes: approach, files and functions to change, tests that prove it, risks, what is out of scope.
The developer is a cheaper model: be exact. List the folders/files the work may change in \`paths\`. If the item is clearly too big for one task, say how to split it.`, ARCHITECT_TOOL);
        if (!r.ok || !r.output) throw new Error(`Architect ${arch.name}: ${r.error ?? "no notes returned"}`);
        const named = devs.find((d) => d.name.toLowerCase() === String(r.output!.worker ?? "").toLowerCase());
        set({
          tech_notes: String(r.output.tech_notes ?? "").slice(0, 8000),
          paths: JSON.stringify(Array.isArray(r.output.paths) ? r.output.paths.map(String).slice(0, 30) : []),
          worker: named?.name ?? "",
        });
      }
      // 3. A developer estimates the size.
      if (item.points == null) {
        const dev = this.developers(project.id).find((d) => d.name === item.worker) ?? this.orch.leastLoadedWorker(teamId);
        if (!dev) throw new Error("The team has no developer to estimate the item");
        set({ step: "estimate" });
        const r = await call(dev, "refine", `# Estimate a backlog item
## ${item.title}
${item.story}

### Acceptance criteria
${item.acceptance || "(none written)"}

### Technical notes (architect)
${item.tech_notes}

Estimate the size in story points (relative effort for you, the developer): ${SIZES.join(", ")}. 1 = a trivial edit, 3 = a normal change,
8 = a large one, 13 = too big for one task and must be split. Look at the code if you need to. Do not change anything.`, ESTIMATE_TOOL);
        const points = Number((r.output as any)?.points);
        if (!r.ok || !SIZES.includes(points)) throw new Error(`${dev.name}: ${r.error ?? "no estimate returned"}`);
        set({ points, ...(points === 13 ? { error: `Estimated 13 points: too big for one task. Split it into smaller items. ${String((r.output as any).reason ?? "")}`.trim() } : {}) });
      }
      set({ status: "ready", step: "" });
      this.say(project.id, item.chat_id, `Backlog item **${item.title}** is ready: ${item.points} point${item.points === 1 ? "" : "s"}.${item.points === 13 ? " That is too big for a sprint task; split it." : " Set its priority on the Backlog page."}`);
    } catch (err) {
      set({ status: "error", error: String((err as Error).message ?? err).slice(0, 600) });
      this.say(project.id, item.chat_id, `Refining **${item.title}** stopped: ${item.error}`);
    }
  }

  private chatInProject(chatId: number, projectId: number) {
    return !!this.db.prepare("SELECT 1 FROM chats WHERE id = ? AND project_id = ?").get(chatId, projectId);
  }

  /** Runs the missing refinement steps again after an error. */
  retryItem(itemId: number) {
    const i = this.item(itemId);
    if (i.status !== "error") throw new Failure(`Item is ${i.status}`);
    this.db.prepare("UPDATE backlog_items SET status = 'refining', error = '', updated_at = datetime('now') WHERE id = ?").run(itemId);
    this.changed(i.project_id);
    this.refine(itemId);
  }

  updateItem(itemId: number, b: Record<string, any>) {
    const i = this.item(itemId);
    if (["in_sprint", "done"].includes(i.status)) throw new Failure("This item is in a sprint; its text is fixed");
    const text = (k: keyof Item, max: number) => (b[k] === undefined ? i[k] : String(b[k]).slice(0, max));
    let points = i.points;
    if (b.points !== undefined) {
      points = b.points === null || b.points === "" ? null : Number(b.points);
      if (points !== null && !SIZES.includes(points)) throw new Failure(`Points must be one of ${SIZES.join(", ")}`);
    }
    const dropped = b.status === "dropped";
    // Editing an estimate or the notes by hand makes a refining or errored item ready again when nothing is missing.
    this.db.prepare(`UPDATE backlog_items SET title = ?, story = ?, acceptance = ?, tech_notes = ?, points = ?, paths = ?, status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(text("title", 120)).trim() || i.title, text("story", 4000), text("acceptance", 4000), text("tech_notes", 8000), points,
        b.paths !== undefined ? JSON.stringify((Array.isArray(b.paths) ? b.paths : String(b.paths).split(/\r?\n/)).map((x: any) => String(x).trim()).filter(Boolean)) : i.paths,
        dropped ? "dropped" : i.status, points === 13 ? i.error : points !== i.points ? "" : i.error, itemId);
    this.changed(i.project_id);
    return this.item(itemId);
  }

  /** The user's priority: the ids in the order given are 1, 2, 3 … */
  reorder(projectId: number, ids: number[]) {
    const upd = this.db.prepare("UPDATE backlog_items SET priority = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?");
    this.db.transaction(() => ids.forEach((id, n) => upd.run(n + 1, id, projectId)))();
    this.changed(projectId);
  }

  // ---------- the Scrum master ----------

  /** Ready items by priority, as many as fit the capacity. An item bigger than a whole sprint is skipped. */
  preview(projectId: number) {
    const cap = this.capacity(projectId);
    const ready = this.db.prepare("SELECT * FROM backlog_items WHERE project_id = ? AND status = 'ready' AND sprint_id IS NULL ORDER BY priority, id").all(projectId) as Item[];
    let used = 0;
    let full = false;
    const rows = ready.map((i) => {
      const pts = i.points ?? 0;
      const tooBig = pts > cap.capacity;
      const fits = !tooBig && !full && used + pts <= cap.capacity;
      if (fits) used += pts; else if (!tooBig) full = true; // priority is kept: after the first item that does not fit, nothing lower goes in
      return { id: i.id, title: i.title, points: i.points, priority: i.priority, selected: fits, too_big: tooBig };
    });
    return { ...cap, used, items: rows, selected: rows.filter((r) => r.selected).map((r) => r.id) };
  }

  /** Starts a sprint: the sprint branch is made and every chosen item becomes a queued task. */
  async start(sprintId: number, itemIds?: number[]) {
    const sprint = this.sprint(sprintId);
    if (sprint.status !== "planning") throw new Failure(`Sprint is ${sprint.status}`);
    const project = this.project(sprint.project_id);
    if (this.db.prepare("SELECT 1 FROM sprints WHERE project_id = ? AND status IN ('active','done')").get(project.id)) {
      throw new Failure("Finish and release the running sprint first");
    }
    const plan = this.preview(project.id);
    const chosen = (itemIds?.length ? itemIds : plan.selected).map((id) => this.item(id));
    if (!chosen.length) throw new Failure("No ready item fits. Refine items first, or choose some by hand.");
    for (const i of chosen) {
      if (i.project_id !== project.id || i.status !== "ready" || i.sprint_id) throw new Failure(`"${i.title}" is not ready for a sprint`);
    }
    await ensureProjectCheckout(project);
    const branch = `sprint/${sprint.number}-${slugify(sprint.name, 30)}`;
    await createSprintBranch(project, branch);
    this.db.prepare("UPDATE sprints SET status = 'active', branch = ?, capacity = ?, started_at = datetime('now') WHERE id = ?").run(branch, plan.capacity, sprintId);
    const chatId = this.ensureSprintChat(sprintId);
    const slugs = new Set((this.db.prepare("SELECT slug FROM tasks WHERE project_id = ?").all(project.id) as { slug: string }[]).map((t) => t.slug));
    const teamId = this.teamOf(project.id);
    for (const i of chosen) {
      let slug = `s${sprint.number}-${i.id}-${slugify(i.title, 24)}`;
      for (let n = 2; slugs.has(slug); n++) slug = `${slug}-${n}`;
      slugs.add(slug);
      const dev = this.developers(project.id).find((d) => d.name === i.worker) ?? this.orch.leastLoadedWorker(teamId);
      const info = this.db.prepare(`INSERT INTO tasks (chat_id, project_id, slug, title, spec, paths, worker_id, status, item_id, sprint_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`)
        .run(chatId, project.id, slug, i.title, this.specOf(i), i.paths, dev?.id ?? null, i.id, sprintId);
      this.db.prepare("UPDATE backlog_items SET status = 'in_sprint', sprint_id = ?, updated_at = datetime('now') WHERE id = ?").run(sprintId, i.id);
      this.orch.updateTask(Number(info.lastInsertRowid), {});
    }
    const points = chosen.reduce((n, i) => n + (i.points ?? 0), 0);
    this.orch.postMessage(chatId, "event", `**Sprint ${sprint.number} "${sprint.name}"** started: ${chosen.length} item${chosen.length > 1 ? "s" : ""}, ${points} of ${plan.capacity} points. Work merges into \`${branch}\`; the base branch is untouched until Release.`);
    this.stalled.delete(sprintId);
    this.changed(project.id);
    this.orch.tick();
    return this.sprint(sprintId);
  }

  private ensureSprintChat(sprintId: number) {
    const s = this.sprint(sprintId);
    if (s.chat_id && this.db.prepare("SELECT 1 FROM chats WHERE id = ?").get(s.chat_id)) return s.chat_id;
    const id = Number(this.db.prepare("INSERT INTO chats (project_id, title) VALUES (?, ?)").run(s.project_id, `Sprint ${s.number}: ${s.name}`.slice(0, 80)).lastInsertRowid);
    this.db.prepare("UPDATE sprints SET chat_id = ? WHERE id = ?").run(id, sprintId);
    return id;
  }

  /** The task text a developer gets: everything the business owner, product manager and architect wrote. */
  private specOf(i: Item) {
    return `## Backlog item #${i.id}: ${i.title}

### User story
${i.story}

### Acceptance criteria
${i.acceptance || "(none written)"}

### Technical notes (architect)
${i.tech_notes}

### Out of scope
Anything the story and the technical notes do not ask for.`;
  }

  // ---------- finishing a sprint ----------

  /** Called whenever a sprint task stops: the sprint is complete when every task merged (or was cancelled). */
  async settle(sprintId: number) {
    const s = this.sprint(sprintId);
    if (s.status !== "active") return;
    const tasks = this.db.prepare("SELECT status FROM tasks WHERE sprint_id = ?").all(sprintId) as { status: string }[];
    if (tasks.some((t) => RUNNING.includes(t.status)) || this.orch.activeTaskIds().some((id) => this.orch.task(id)?.sprint_id === sprintId)) {
      this.stalled.delete(sprintId);
      return;
    }
    if (tasks.every((t) => TERMINAL.includes(t.status))) return this.finish(sprintId);
    if (!this.stalled.has(sprintId)) {
      this.stalled.add(sprintId);
      const n = tasks.filter((t) => !TERMINAL.includes(t.status)).length;
      this.orch.postMessage(this.ensureSprintChat(sprintId), "event",
        `Sprint ${s.number} has ${n} task${n > 1 ? "s" : ""} that stopped. Retry ${n > 1 ? "them" : "it"}, or close the sprint to send unfinished items back to the backlog.`);
    }
    this.changed(s.project_id);
  }

  /** Close the sprint now: stopped tasks are dropped, their items go back to the backlog. */
  async close(sprintId: number) {
    const s = this.sprint(sprintId);
    if (s.status !== "active") throw new Failure(`Sprint is ${s.status}`);
    const project = this.project(s.project_id);
    const tasks = this.db.prepare("SELECT * FROM tasks WHERE sprint_id = ?").all(sprintId) as TaskRow[];
    for (const t of tasks) {
      if (TERMINAL.includes(t.status)) continue;
      this.orch.cancel(t.id);
      if (t.branch) await removeWorktree(project, t.worktree, t.branch, true).catch(() => {});
      this.db.prepare("UPDATE tasks SET status = 'cancelled', worktree = '' WHERE id = ?").run(t.id);
    }
    await this.finish(sprintId);
    return this.sprint(sprintId);
  }

  private async finish(sprintId: number) {
    const key = `finish:${sprintId}`;
    if (this.working.has(key)) return;
    this.working.add(key);
    try {
      const s = this.sprint(sprintId);
      if (s.status !== "active") return;
      // Items whose work never merged return to the backlog, ready to be planned again.
      this.db.prepare(`UPDATE backlog_items SET status = 'ready', sprint_id = NULL, updated_at = datetime('now')
        WHERE sprint_id = ? AND status = 'in_sprint'`).run(sprintId);
      this.db.prepare("UPDATE sprints SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(sprintId);
      this.changed(s.project_id);
      const chatId = this.ensureSprintChat(sprintId);
      this.orch.postMessage(chatId, "event", `**Sprint ${s.number} "${s.name}"** is complete. Writing the release notes.`);
      await this.writeNotes(sprintId);
      this.orch.postMessage(chatId, "event", `Release notes for sprint ${s.number} are ready. You can run a security review, then press **Release** to merge \`${s.branch}\` into the base branch and push it.`);
    } finally {
      this.working.delete(key);
      this.changed(this.sprint(sprintId).project_id);
    }
  }

  /** Release notes: the product manager writes them from what was delivered; a plain list is the fallback. */
  async writeNotes(sprintId: number) {
    const s = this.sprint(sprintId);
    const project = this.project(s.project_id);
    const done = this.db.prepare(`SELECT b.title, b.story, t.summary FROM backlog_items b JOIN tasks t ON t.item_id = b.id AND t.sprint_id = ?
      WHERE t.status = 'merged' ORDER BY b.priority`).all(sprintId) as { title: string; story: string; summary: string }[];
    const returned = (this.db.prepare("SELECT title FROM backlog_items WHERE project_id = ? AND sprint_id IS NULL AND status = 'ready' AND id IN (SELECT item_id FROM tasks WHERE sprint_id = ?)")
      .all(project.id, sprintId) as { title: string }[]).map((r) => r.title);
    const fallback = `## Sprint ${s.number}: ${s.name}\n${s.goal ? `\n${s.goal}\n` : ""}\n### Delivered\n${done.map((d) => `- **${d.title}**`).join("\n") || "- Nothing was merged."}\n${returned.length ? `\n### Not finished (back in the backlog)\n${returned.map((t) => `- ${t}`).join("\n")}\n` : ""}`;
    let notes = fallback;
    const pm = pickAgent(this.db, "planner", { teamId: this.teamOf(project.id) });
    if (pm && done.length) {
      const log = await branchLog(project, s.branch, project.base_branch);
      const r = await this.orch.callAgent({
        agent: pm, kind: "notes", projectId: project.id, sprintId, cwd: project.path, mode: "read", output: NOTES_TOOL,
        prompt: `Write the release notes of sprint ${s.number} "${s.name}" for the business owners and users (not developers).
${s.goal ? `Sprint goal: ${s.goal}\n` : ""}
Delivered items:
${done.map((d) => `### ${d.title}\n${d.story}\nDeveloper's summary: ${d.summary.split("\n").slice(0, 8).join(" ").slice(0, 600)}`).join("\n\n")}
${returned.length ? `\nNot finished: ${returned.join("; ")}\n` : ""}
Commits on the sprint branch:
${log || "(none)"}

Markdown, under 40 lines: a one-sentence summary, what is new or changed in plain words (grouped if there are many), known limits, what is not finished.
Only state what the items and commits support.`,
      });
      if (r.ok && r.output?.notes) notes = String(r.output.notes);
    }
    this.db.prepare("UPDATE sprints SET release_notes = ? WHERE id = ?").run(notes, sprintId);
    return notes;
  }

  // ---------- security review and release ----------

  /** Optional: a security look at everything the sprint changes, before it reaches the base branch. */
  async securityReview(sprintId: number) {
    const s = this.sprint(sprintId);
    if (s.status !== "done") throw new Failure("The security review runs on a completed sprint");
    const key = `security:${sprintId}`;
    if (this.working.has(key)) throw new Failure("The security review is already running", 409);
    const project = this.project(s.project_id);
    const agent = securityOf(this.db, this.teamOf(project.id));
    if (!agent) throw new Failure("The team has no reviewer for the security review. Add one under Teams.");
    this.working.add(key);
    this.changed(project.id);
    void (async () => {
      try {
        const wt = await ensureSprintWorktree(project, join(this.orch.dataDir, "worktrees"), sprintId, s.branch);
        const remote = await projectHasRemote(project);
        const diffStat = await diffAgainstBase(wt, project.base_branch, remote);
        const items = (this.db.prepare("SELECT title FROM tasks WHERE sprint_id = ? AND status = 'merged'").all(sprintId) as { title: string }[]).map((t) => t.title);
        const r = await this.orch.callAgent({
          agent, kind: "security", projectId: project.id, sprintId, cwd: wt, mode: "read", output: SECURITY_TOOL,
          prompt: buildSecurityPrompt({ sprint: `Sprint ${s.number} "${s.name}"`, goal: s.goal, branch: s.branch, base: remote ? `origin/${project.base_branch}` : project.base_branch, diffStat, items }),
        });
        const chatId = this.ensureSprintChat(sprintId);
        if (!r.ok || !r.output) {
          this.orch.postMessage(chatId, "event", `Security review by ${agent.name} failed: ${r.error ?? "no verdict"}`, agent.id);
        } else {
          const verdict = r.output.verdict === "issues" ? "issues" : "pass";
          this.db.prepare("UPDATE sprints SET security_verdict = ?, security_report = ? WHERE id = ?").run(verdict, String(r.output.report ?? ""), sprintId);
          this.orch.postMessage(chatId, "event", `Security review of sprint ${s.number} by ${agent.name}: **${verdict === "pass" ? "no blocking findings" : "issues found"}**. The report is on the sprint page.`, agent.id);
        }
      } catch (err) {
        this.orch.postMessage(this.ensureSprintChat(sprintId), "event", `Security review failed: ${(err as Error).message}`);
      } finally {
        this.working.delete(key);
        this.changed(project.id);
      }
    })();
  }

  /** Move to production: the sprint branch merges into the base branch, which is pushed when the project has a remote. */
  async release(sprintId: number) {
    const s = this.sprint(sprintId);
    if (s.status !== "done") throw new Failure(s.status === "released" ? "Already released" : "Finish the sprint first");
    if (this.working.has(`security:${sprintId}`)) throw new Failure("Wait for the security review to finish");
    const project = this.project(s.project_id);
    const push = getSettings(this.db).push_and_pr === "true" && process.env.AGENTDESK_DEMO !== "1";
    const message = `Sprint ${s.number}: ${s.name}${s.release_notes ? `\n\n${s.release_notes.slice(0, 4000)}` : ""}`;
    const result = await releaseSprint(project, s.branch, message, push);
    const wt = join(this.orch.dataDir, "worktrees", `${project.id}-sprint-${sprintId}`);
    await removeWorktree(project, wt, s.branch, false).catch(() => {});
    await deleteBranch(project, s.branch);
    this.db.prepare("UPDATE sprints SET status = 'released', released_at = datetime('now') WHERE id = ?").run(sprintId);
    this.db.prepare("UPDATE backlog_items SET status = 'done' WHERE sprint_id = ? AND status = 'in_sprint'").run(sprintId);
    this.orch.postMessage(this.ensureSprintChat(sprintId), "event", `**Sprint ${s.number} released.** ${result}.`);
    this.changed(project.id);
    return result;
  }

  // ---------- the overview the UI shows ----------

  /** Tokens and cost by sprint and PI. Refinement of an item counts for the sprint the item went into. */
  usage(projectId: number) {
    const rows = this.db.prepare(`SELECT COALESCE(r.sprint_id, b.sprint_id) AS sid, r.kind, r.model, COUNT(*) AS runs,
        COALESCE(SUM(r.cost_usd), 0) AS cost, COALESCE(SUM(r.tokens_in + r.cache_read + r.cache_write + r.tokens_out), 0) AS tokens
      FROM runs r LEFT JOIN backlog_items b ON b.id = r.item_id
      WHERE r.project_id = ? AND r.engine != 'shell' AND r.engine != '' GROUP BY sid, r.kind, r.model`).all(projectId) as
      { sid: number | null; kind: string; model: string; runs: number; cost: number; tokens: number }[];
    type Bucket = { cost: number; tokens: number; runs: number; by_kind: Record<string, { cost: number; tokens: number; runs: number }>; by_model: Record<string, { cost: number; tokens: number; runs: number }> };
    const empty = (): Bucket => ({ cost: 0, tokens: 0, runs: 0, by_kind: {}, by_model: {} });
    const add = (b: Bucket, r: (typeof rows)[number]) => {
      b.cost += r.cost; b.tokens += r.tokens; b.runs += r.runs;
      for (const [map, k] of [[b.by_kind, r.kind], [b.by_model, r.model || "unknown"]] as const) {
        const e = (map[k] ??= { cost: 0, tokens: 0, runs: 0 });
        e.cost += r.cost; e.tokens += r.tokens; e.runs += r.runs;
      }
    };
    const sprints: Record<number, Bucket> = {};
    const unplanned = empty();
    for (const r of rows) add(r.sid == null ? unplanned : (sprints[r.sid] ??= empty()), r);
    const pis: Record<number, Bucket> = {};
    for (const s of this.db.prepare("SELECT id, pi_id FROM sprints WHERE project_id = ? AND pi_id IS NOT NULL").all(projectId) as { id: number; pi_id: number }[]) {
      for (const r of rows.filter((x) => x.sid === s.id)) add((pis[s.pi_id] ??= empty()), r);
    }
    return { sprints, pis, unplanned };
  }

  overview(projectId: number) {
    const project = this.project(projectId);
    const items = this.db.prepare("SELECT * FROM backlog_items WHERE project_id = ? ORDER BY CASE WHEN status IN ('done','dropped') THEN 1 ELSE 0 END, priority, id").all(projectId) as Item[];
    const sprints = this.db.prepare("SELECT * FROM sprints WHERE project_id = ? ORDER BY number DESC").all(projectId) as Sprint[];
    const tasks = this.db.prepare(`SELECT t.id, t.item_id, t.sprint_id, t.title, t.status, t.round, t.worker_id, a.name AS worker, t.cost_usd, t.tokens, t.error, t.chat_id
      FROM tasks t LEFT JOIN agents a ON a.id = t.worker_id WHERE t.sprint_id IS NOT NULL AND t.project_id = ? ORDER BY t.id`).all(projectId);
    const u = this.usage(projectId);
    // What each item cost so far (refinement, and development once it is in a sprint), shown like a task's cost.
    const spent = new Map((this.db.prepare(`SELECT item_id, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost,
        COALESCE(SUM(tokens_in + cache_read + cache_write + tokens_out), 0) AS tokens
      FROM runs WHERE project_id = ? AND item_id IS NOT NULL AND engine != 'shell' AND engine != '' GROUP BY item_id`).all(projectId) as
      { item_id: number; runs: number; cost: number; tokens: number }[]).map((r) => [r.item_id, r]));
    return {
      project: { id: project.id, name: project.name, process: project.process, points_per_dev: project.points_per_dev },
      cycle: this.cycle(projectId),
      capacity: this.capacity(projectId),
      pis: (this.db.prepare("SELECT * FROM pis WHERE project_id = ? ORDER BY id DESC").all(projectId) as Pi[]).map((p) => ({ ...p, usage: u.pis[p.id] ?? null })),
      sprints: sprints.map((s) => ({ ...s, usage: u.sprints[s.id] ?? null, busy: this.working.has(`security:${s.id}`) || this.working.has(`finish:${s.id}`) })),
      items: items.map((i) => ({ ...i, refining: this.working.has(`refine:${i.id}`), cost: spent.get(i.id)?.cost ?? 0, tokens: spent.get(i.id)?.tokens ?? 0, runs: spent.get(i.id)?.runs ?? 0 })),
      tasks,
      unplanned: u.unplanned,
    };
  }
}

// ---------- routes ----------

export function registerScrum(app: FastifyInstance, db: DB, scrum: Scrum) {
  const id = (v: unknown) => Number(v);
  const run = async (reply: any, fn: () => unknown) => {
    try { return await fn(); } catch (err) {
      const e = err as Error & { status?: number };
      return reply.code(e.status ?? 500).send({ error: e.message });
    }
  };
  type Body = Record<string, any>;

  app.get("/api/projects/:id/scrum", async (req, reply) => run(reply, () => scrum.overview(id((req.params as Body).id))));
  app.get("/api/projects/:id/scrum/preview", async (req, reply) => run(reply, () => scrum.preview(id((req.params as Body).id))));
  app.put("/api/projects/:id/scrum/settings", async (req, reply) => run(reply, () => {
    const b = req.body as Body;
    const projectId = id((req.params as Body).id);
    if (b.process !== undefined && !["free", "scrum"].includes(b.process)) throw Object.assign(new Error("process must be free or scrum"), { status: 400 });
    const pts = b.points_per_dev === undefined ? undefined : Math.max(1, Math.min(60, Math.round(Number(b.points_per_dev)) || 8));
    db.prepare("UPDATE projects SET process = COALESCE(?, process), points_per_dev = COALESCE(?, points_per_dev) WHERE id = ?").run(b.process ?? null, pts ?? null, projectId);
    bus.publish({ type: "scrum", projectId });
    return scrum.overview(projectId);
  }));

  app.post("/api/projects/:id/pis", async (req, reply) => run(reply, () => scrum.createPi(id((req.params as Body).id), String((req.body as Body).name ?? ""), String((req.body as Body).goal ?? ""))));
  app.put("/api/pis/:id", async (req, reply) => run(reply, () => {
    const b = req.body as Body;
    const pi = db.prepare("SELECT * FROM pis WHERE id = ?").get(id((req.params as Body).id)) as { project_id: number; name: string; goal: string; status: string } | undefined;
    if (!pi) throw Object.assign(new Error("Not found"), { status: 404 });
    db.prepare("UPDATE pis SET name = ?, goal = ?, status = ? WHERE id = ?").run(String(b.name ?? pi.name).slice(0, 80), String(b.goal ?? pi.goal).slice(0, 600), b.status === "closed" ? "closed" : b.status === "active" ? "active" : pi.status, id((req.params as Body).id));
    bus.publish({ type: "scrum", projectId: pi.project_id });
    return { ok: true };
  }));
  app.post("/api/projects/:id/sprints", async (req, reply) => run(reply, () => {
    const b = req.body as Body;
    return scrum.createSprint(id((req.params as Body).id), String(b.name ?? ""), String(b.goal ?? ""), b.pi_id === undefined ? undefined : b.pi_id ? id(b.pi_id) : null);
  }));
  app.put("/api/sprints/:id", async (req, reply) => run(reply, () => {
    const b = req.body as Body;
    const s = scrum.sprint(id((req.params as Body).id));
    const pi = b.pi_id === undefined ? s.pi_id : b.pi_id ? id(b.pi_id) : null;
    db.prepare("UPDATE sprints SET name = ?, goal = ?, pi_id = ? WHERE id = ?").run(String(b.name ?? s.name).slice(0, 80), String(b.goal ?? s.goal).slice(0, 600), pi, s.id);
    bus.publish({ type: "scrum", projectId: s.project_id });
    return { ok: true };
  }));
  app.post("/api/sprints/:id/start", async (req, reply) => run(reply, async () => {
    const ids = Array.isArray((req.body as Body)?.item_ids) ? (req.body as Body).item_ids.map(Number).filter(Number.isFinite) : undefined;
    return scrum.start(id((req.params as Body).id), ids);
  }));
  app.post("/api/sprints/:id/close", async (req, reply) => run(reply, () => scrum.close(id((req.params as Body).id))));
  app.post("/api/sprints/:id/security", async (req, reply) => run(reply, async () => { await scrum.securityReview(id((req.params as Body).id)); return { started: true }; }));
  app.post("/api/sprints/:id/release", async (req, reply) => run(reply, async () => ({ result: await scrum.release(id((req.params as Body).id)) })));
  app.delete("/api/sprints/:id", async (req, reply) => run(reply, () => {
    const s = scrum.sprint(id((req.params as Body).id));
    if (s.status !== "planning") throw Object.assign(new Error("Only a planned sprint can be deleted"), { status: 400 });
    db.prepare("DELETE FROM sprints WHERE id = ?").run(s.id);
    bus.publish({ type: "scrum", projectId: s.project_id });
    return { ok: true };
  }));

  app.post("/api/projects/:id/backlog", async (req, reply) => run(reply, () => {
    const b = req.body as Body;
    const title = String(b.title ?? "").trim();
    if (!title) throw Object.assign(new Error("A title is required"), { status: 400 });
    return scrum.addItem(id((req.params as Body).id), { title, request: b.request ?? b.description, story: b.story, acceptance: b.acceptance }, b.chat_id ? id(b.chat_id) : null);
  }));
  app.put("/api/projects/:id/backlog/order", async (req, reply) => run(reply, () => {
    const ids = Array.isArray((req.body as Body).ids) ? (req.body as Body).ids.map(Number).filter(Number.isFinite) : [];
    scrum.reorder(id((req.params as Body).id), ids);
    return { ok: true };
  }));
  app.put("/api/backlog/:id", async (req, reply) => run(reply, () => scrum.updateItem(id((req.params as Body).id), (req.body ?? {}) as Body)));
  app.post("/api/backlog/:id/retry", async (req, reply) => run(reply, () => { scrum.retryItem(id((req.params as Body).id)); return { ok: true }; }));
}
