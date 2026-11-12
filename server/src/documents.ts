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

const BUILTIN = [
  { builtin: "cycle", title: "Development cycle", body: CYCLE },
  { builtin: "models", title: "Choosing AI models", body: MODELS },
] as const;

/** Insert the two shared guides once. Deleting one does not bring it back. */
export function seedDocuments(db: DB) {
  if (db.prepare("SELECT value FROM settings WHERE key = 'documents_seeded'").get()) return;
  const ins = db.prepare("INSERT INTO documents (title, body, kind, builtin) VALUES (?, ?, 'generic', ?)");
  db.transaction(() => {
    for (const page of BUILTIN) ins.run(page.title, page.body, page.builtin);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('documents_seeded', '1')").run();
  })();
}
