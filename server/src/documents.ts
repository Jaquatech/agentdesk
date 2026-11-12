import type { DB } from "./db.ts";

/** The development-cycle guide, kept as a generic document so it stays readable after the Guides menu moved. */
const CYCLE = `AgentDesk runs a project in one of two ways. Pick it per project under Projects → **How work is run**.
Both use the same safety net: every task gets its own branch, the verify commands must pass, and a reviewer agent (QA) checks it before anything is merged.

## Free chat: quick changes

1. **You ask** in the project's chat. The team's planner reads the code and proposes tasks.
2. **You press Run plan.** Each task starts on its own branch and worktree.
3. **A developer builds it**, the verify commands run, the reviewer approves or asks for changes (up to the fix rounds set in Settings).
4. **You press Merge.** GitHub projects get a pull request first.

Best for: a fix, a small feature, trying an idea. You decide every step.

## Scrum: planned work in sprints

For work that is bigger than one chat: many requests, several developers, and a release at the end. Work moves through the stages below.
The chat of a Scrum project always talks to the product manager, and a bar above it shows which stage you are in.

1. **Set up** (you, once). Make a team with a planner (the **product manager**), one or more developers, a reviewer (QA), and optionally an **architect** and a **security reviewer** (Teams). The gallery on the Agents page has a Scrum product manager and an Architect. Set the project to Scrum and decide how many points one developer does per sprint (default 8).
2. **Backlog** (business owners + product manager). Optionally ask for a **PI** (a goal over several sprints) or a sprint. Then describe what is needed in the chat, in your own words. The product manager turns it into backlog items with a user story and acceptance criteria. You can add items at any stage and ask "review the backlog" for duplicates, gaps and a suggested order.
3. **Refinement** (automatic). Each new item goes on by itself: the **architect** reads the code and writes technical notes (approach, files, tests, a suggested developer), then a **developer** estimates the size in points (1 to 13). When that is done the item is **Ready**. An item sized 13 is too big for a task: split it. If a step fails, the item shows *stopped* with a Retry button.
4. **Priority** (you). On the Backlog page, move items up or down. The order is the order the sprint is filled in.
5. **Sprint planning** (Scrum master: automatic proposal). Create a sprint. The Scrum master proposes ready items in priority order until the capacity is used (*developers in the team × points per developer*). It stops at the first item that does not fit, so priority is never skipped. Untick or tick items to change the plan, then press **Start sprint**.
6. **The sprint runs** (developers + QA). The sprint gets its own git branch. Every item becomes a task: a developer builds it, the verify commands run, QA reviews it, with fix rounds as needed. An approved task is merged into the **sprint branch**, not into main. Progress messages go to the sprint's own chat. If a task stops, retry it from Running tasks, or press **Close sprint** to send unfinished items back to the backlog.
7. **Sprint complete** (automatic). When every task has merged, the sprint is complete and the product manager writes the **release notes**. Open the sprint to read them.
8. **Security review** (optional). The security reviewer reads everything the sprint changed compared with main: secrets, injection, missing checks, risky dependencies. It reports "no blocking findings" or "issues found" with the details. Worth running before anything customer-facing; skip it for internal tools.
9. **Release to production** (you). Merges the sprint branch into the base branch and pushes it (when the project has a remote). Main is untouched until this moment. The project folder must be on the base branch with no uncommitted changes. If the push is refused (protected branch), the merge stays local and you are told.

## Reading the numbers

- **Token use per sprint** is on each sprint card and adds up under the PI. It is split by kind of work: product manager, refinement, development, QA, security and release notes. Refinement of an item counts for the sprint the item went into; work before that is listed as "not in any sprint yet".
- **Capacity** is a guide, not a promise. Points are relative: calibrate after the first sprint. If the team always finishes early, raise the points per developer; if tasks keep stopping, lower it.
- **Spending limits** (Settings): a cap per day and one per sprint. A banner appears from 80%. At the limit, queued tasks wait and no new agent call starts; raise the limit and work carries on by itself. A task that was mid-call fails with "Budget reached": press Retry. Only finished calls are counted, and local or unpriced models count as $0.
- **One sprint at a time:** release or close the running sprint before starting the next.

## Which model for which role

- **Product manager** — Sonnet. Unclear requests become unclear items for everyone downstream.
- **Architect** — Sonnet (Opus for hard systems). Its notes are what a cheaper developer model follows; planning mistakes spread to every task.
- **Developers** — Haiku for code and logic, Sonnet for UI. Haiku is good enough for routine code at a fraction of the cost; layout and CSS need more.
- **Estimating** — the developer's own model. The same agent that would do the work sizes it.
- **QA reviewer** — Sonnet. Catches the developer's mistakes; reads little and writes little, so it stays cheap.
- **Security reviewer** — Sonnet (Opus for sensitive code). Runs once per sprint over the whole diff, so a stronger model costs little overall.

See **Choosing AI models** for ratings of each model and what your own runs cost.

## Common problems

- **An item stays "refining" or shows stopped.** The team lacks an architect or developer, or a model failed. Fix the team, then Retry on the item.
- **"No ready item fits."** Nothing is Ready yet, or every ready item is bigger than the capacity. Check sizes on the Backlog page.
- **A task conflicts with the sprint branch.** Two tasks changed the same lines. Retry it after the other tasks have merged, or have the architect give tasks separate files.
- **Release says the folder has uncommitted changes.** Commit or stash your own work in the project folder and check it is on the base branch.
- **Merge says the pull request is a draft.** Fixed in current versions: pull requests open ready for review, and Merge marks older drafts ready first.
`;

/** Intro for the live model guide. The ratings themselves stay computed, so this page does not freeze them. */
const MODELS = `Which model to give which agent. If you are new, use the **start here** models and move up only when a task fails.
When you pick a model for an agent, the form lists what your provider offers for that job, using this guide.

The ratings below are the live guide: solid pips were seen in real runs here, faded pips are expectations. Your own runs are listed on each model when this machine has them.
`;

/** Shared coding and testing notes. No project, data, or customer names: this page is general. */
const GUIDELINES = `How to change code in any project. Names of a particular project, its data, or its customers do not belong on this page.

## Changes

- Match the surrounding code. Small, readable edits. No new package unless the task says so.
- One task changes one concern. Say what is out of scope.
- Secrets and personal data are never printed, logged, or committed.

## Testing

- Every behaviour change has a check that fails without the change and passes with it.
- Run the project's verify commands. A check that cannot run (missing script, missing setting) is a setup problem, not a reason to delete the check.
- Prefer the smallest test that proves the change. Do not weaken a check to make it pass.
- A task is not done while its checks fail.
`;

const BUILTIN = [
  { builtin: "guidelines", title: "Coding guidelines", body: GUIDELINES },
  { builtin: "models", title: "Choosing AI models", body: MODELS },
  { builtin: "cycle", title: "Development cycle", body: CYCLE },
] as const;

/** The single living page of a project. Decisions and release notes are sections that hold many pages. */
export const STANDARD_PAGES = [
  { slot: "overview", title: "Overview", body: "What this project is, its goals, and the stack.\n" },
  { slot: "architecture", title: "Architecture", body: "How the system is shaped.\n" },
  { slot: "roadmap", title: "Road map", body: "Backlog items and ideas that are not tasked yet.\n" },
  { slot: "setup", title: "Setup", body: "How to run it, the environment, and gotchas.\n" },
] as const;

const SLOT_SET = new Set<string>(STANDARD_PAGES.map((p) => p.slot));

type TaskBits = { id: number; project_id: number; title: string; spec: string; summary: string; review: string; verdict: string };

/** Insert any missing general guides, then the standard pages of every project and a page for every task. */
export function seedDocuments(db: DB) {
  const ins = db.prepare("INSERT INTO documents (title, body, kind, builtin) VALUES (?, ?, 'generic', ?)");
  db.transaction(() => {
    for (const page of BUILTIN) {
      if (!db.prepare("SELECT id FROM documents WHERE builtin = ?").get(page.builtin)) ins.run(page.title, page.body, page.builtin);
    }
    for (const p of db.prepare("SELECT id FROM projects").all() as { id: number }[]) ensureProjectPages(db, p.id);
    for (const t of db.prepare("SELECT id FROM tasks").all() as { id: number }[]) ensureTaskPage(db, t.id);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('documents_seeded', '1')").run();
  })();
}

/** Overview, Architecture, Road map, and Setup. Decisions and Release notes stay empty sections. */
export function ensureProjectPages(db: DB, projectId: number) {
  const ins = db.prepare("INSERT INTO documents (project_id, title, body, kind, section, slot) VALUES (?, ?, ?, 'project', ?, ?)");
  for (const page of STANDARD_PAGES) {
    if (db.prepare("SELECT id FROM documents WHERE project_id = ? AND slot = ?").get(projectId, page.slot)) continue;
    ins.run(projectId, page.title, page.body, page.slot, page.slot);
  }
}

export function taskPageBody(t: Pick<TaskBits, "spec" | "summary" | "review" | "verdict">) {
  const verdict = t.verdict === "approve" ? "Approved." : t.verdict === "changes" ? "Changes asked." : "";
  const review = [verdict, t.review?.trim() ?? ""].filter(Boolean).join("\n\n");
  return `## Spec\n\n${t.spec ?? ""}\n\n## Developer's summary\n\n${t.summary ?? ""}\n\n## Review\n\n${review}\n`;
}

function sectionText(body: string, name: string): string | null {
  const m = new RegExp(`^## ${name}\\s*$`, "im").exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

/** Read Spec, Developer's summary, and Review out of a task page. Missing headings are left unchanged. */
export function parseTaskPage(body: string): { spec?: string; summary?: string; review?: string; verdict?: string } {
  const out: { spec?: string; summary?: string; review?: string; verdict?: string } = {};
  const spec = sectionText(body, "Spec");
  const summary = sectionText(body, "Developer's summary");
  const reviewBlock = sectionText(body, "Review");
  if (spec !== null) out.spec = spec;
  if (summary !== null) out.summary = summary;
  if (reviewBlock !== null) {
    if (/^Approved\.?\s*/i.test(reviewBlock)) { out.verdict = "approve"; out.review = reviewBlock.replace(/^Approved\.?\s*/i, "").trim(); }
    else if (/^Changes asked\.?\s*/i.test(reviewBlock)) { out.verdict = "changes"; out.review = reviewBlock.replace(/^Changes asked\.?\s*/i, "").trim(); }
    else out.review = reviewBlock;
  }
  return out;
}

/** Create the task's wiki page if it does not exist yet, then copy the task's text onto it. */
export function syncTaskPage(db: DB, taskId: number) {
  const t = db.prepare("SELECT id, project_id, title, spec, summary, review, verdict FROM tasks WHERE id = ?").get(taskId) as TaskBits | undefined;
  if (!t) return;
  const body = taskPageBody(t);
  const existing = db.prepare("SELECT id FROM documents WHERE task_id = ?").get(taskId) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE documents SET title = ?, body = ?, project_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(t.title, body, t.project_id, existing.id);
    refreshLinks(db, existing.id, body);
    return;
  }
  const info = db.prepare("INSERT INTO documents (project_id, title, body, kind, section, task_id) VALUES (?, ?, ?, 'project', 'tasks', ?)")
    .run(t.project_id, t.title, body, t.id);
  refreshLinks(db, Number(info.lastInsertRowid), body);
}

export function ensureTaskPage(db: DB, taskId: number) {
  if (!db.prepare("SELECT id FROM documents WHERE task_id = ?").get(taskId)) syncTaskPage(db, taskId);
}

/** A task page was edited in the wiki: copy Spec, summary, and Review back onto the task. */
export function applyTaskPage(db: DB, taskId: number, title: string, body: string) {
  const cur = db.prepare("SELECT spec, summary, review, verdict FROM tasks WHERE id = ?").get(taskId) as { spec: string; summary: string; review: string; verdict: string } | undefined;
  if (!cur) return;
  const parsed = parseTaskPage(body);
  db.prepare("UPDATE tasks SET title = ?, spec = ?, summary = ?, review = ?, verdict = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title, parsed.spec ?? cur.spec, parsed.summary ?? cur.summary, parsed.review ?? cur.review, parsed.verdict ?? cur.verdict, taskId);
}

/** Page ids mentioned as #/documents/N or doc:N. */
export function mentionedPages(body: string): number[] {
  const ids = new Set<number>();
  for (const m of body.matchAll(/#\/documents\/(\d+)/g)) ids.add(Number(m[1]));
  for (const m of body.matchAll(/\bdoc:(\d+)\b/g)) ids.add(Number(m[1]));
  return [...ids];
}

export function refreshLinks(db: DB, docId: number, body: string) {
  db.prepare("DELETE FROM document_links WHERE from_id = ?").run(docId);
  const ins = db.prepare("INSERT OR IGNORE INTO document_links (from_id, to_id) VALUES (?, ?)");
  for (const to of mentionedPages(body)) {
    if (to === docId) continue;
    if (db.prepare("SELECT id FROM documents WHERE id = ?").get(to)) ins.run(docId, to);
  }
}

export type WikiWrite = { title?: string; section?: string; body?: string };

/** Planner writes. Only this project's pages. General pages are refused. */
export function applyWikiWrites(db: DB, projectId: number, writes: WikiWrite[]) {
  let updated = 0;
  const note = db.prepare("UPDATE documents SET body = ?, updated_at = datetime('now') WHERE id = ?");
  for (const w of writes ?? []) {
    const title = String(w.title ?? "").trim().slice(0, 200);
    const body = String(w.body ?? "");
    const section = String(w.section ?? "").trim();
    if (!title || !body.trim()) continue;
    if (SLOT_SET.has(section)) {
      const row = db.prepare("SELECT id FROM documents WHERE project_id = ? AND slot = ?").get(projectId, section) as { id: number } | undefined;
      if (!row) continue;
      note.run(body, row.id);
      refreshLinks(db, row.id, body);
      updated++;
    } else if (section === "decisions" || section === "releases") {
      const row = db.prepare("SELECT id FROM documents WHERE project_id = ? AND section = ? AND title = ? AND task_id IS NULL").get(projectId, section, title) as { id: number } | undefined;
      if (row) note.run(body, row.id);
      else {
        const info = db.prepare("INSERT INTO documents (project_id, title, body, kind, section) VALUES (?, ?, ?, 'project', ?)")
          .run(projectId, title, body, section);
        refreshLinks(db, Number(info.lastInsertRowid), body);
        updated++;
        continue;
      }
      refreshLinks(db, row.id, body);
      updated++;
    }
  }
  return updated;
}

/** Project pages for an agent's prompt. General pages are not included. */
export function projectWikiContext(db: DB, projectId: number) {
  const rows = db.prepare("SELECT title, section, body FROM documents WHERE project_id = ? ORDER BY section, title").all(projectId) as { title: string; section: string; body: string }[];
  if (!rows.length) return "";
  let out = "# Project documents\nThese pages are the project's wiki. Keep them true when you learn something that belongs there.";
  let used = out.length;
  for (const r of rows) {
    const chunk = `\n\n## ${r.title}${r.section ? ` (${r.section})` : ""}\n${r.body}`.slice(0, 1800);
    if (used + chunk.length > 24_000) { out += "\n\n(further pages omitted)"; break; }
    out += chunk;
    used += chunk.length;
  }
  return out;
}
