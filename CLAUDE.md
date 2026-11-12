# AgentDesk: notes for coding agents

A local-only tool where a planner splits work across developer agents and a reviewer checks it. React UI, Fastify server,
`node:sqlite` database. It runs on the user's machine and listens on 127.0.0.1 only. README.md is the user manual; this file is the map and the rules.

## Commands

```bash
npm run setup        # install + build the UI
npm run dev          # server on 4317 (reload) + Vite on 5173 (/api proxied)
npm run demo         # scripted agents, no key, no cost, separate data folder (data-demo/)
npm test             # server (vitest, ~52 tests) + web
npm run build        # web build + server typecheck (tsc --noEmit)
npx tsc --noEmit -p server        # quick typecheck
npx vitest run --root server test/scrum.test.ts   # one test file
```

Node >= 22.13 (uses the built-in `node:sqlite`). The UI is shadcn/ui on Tailwind (Vite, not Next.js): components in `web/src/components/ui/`, theme tokens in `web/src/styles.css` from preset `b1a09SuFE` (stone, amber, blue charts, Roboto; class `dark` on `<html>`, default dark). Icons from lucide-react. The isometric office (`web/src/office/`) is canvas drawing and is not part of that system; its chrome CSS is hardcoded at the bottom of `styles.css` so Tailwind does not restyle it.

## Code map

| Concept | Where |
|---|---|
| App wiring, local-only host/origin checks | `server/src/index.ts` |
| Routes (settings, secrets, providers, agents, projects, chats, tasks, approvals, events) | `server/src/routes.ts` |
| Schema: append-only `MIGRATIONS` array | `server/src/db.ts` |
| Planner, task pipeline (worktree, build, commit, checks, review rounds, PR, merge), approvals | `server/src/orchestrator/orchestrator.ts`, `git.ts`, `prompts.ts`, `shell.ts` |
| Engines: Claude CLI, built-in API loop, demo | `server/src/engines/` |
| Providers (Anthropic, OpenAI-compatible, Ollama, Claude CLI), capabilities | `server/src/providers/` |
| Teams: who plans, builds, reviews (`pickAgent`, `teamAgents`, architect and security slots) | `server/src/teams.ts` |
| Agent gallery: ready-made agent templates | `server/src/gallery.ts` |
| Model guide: which model for which work, "seen" vs "expected" ratings | `server/src/modelGuide.ts` |
| Scrum: backlog, refinement, sprints, PIs, security review, release, usage per sprint | `server/src/scrum.ts` |
| Spending limits (per day, per sprint) | `server/src/budget.ts` |
| Usage and prices | `server/src/usage.ts`, `pricing.ts` |
| Live events to the UI (SSE) | `server/src/bus.ts` |
| UI pages | `web/src/pages/` (Documents, Scrum, Teams, Agents, Chat, Settings, ...) |
| Documents (wiki pages in SQLite) | `server/src/documents.ts`, `web/src/pages/DocumentsPage.tsx` |

## How the pieces fit

- **Task pipeline** (one task = one branch `task/<slug>` + one worktree under the data folder): worker builds, a commit is made only if every changed file is inside the task's allowed paths, verify commands must pass, the reviewer approves or sends fix instructions (rounds are a Setting), then push + PR (projects with a remote) and the user presses Merge. `tasks.feedback` keeps the last round's fix text so a retry continues instead of starting blind. `tasks.summary` is what the rounds that changed files did (later rounds are added as `Round N: ...`); a round that changes nothing never replaces it, since it ends up in the merge commit and the release notes.
- **Task export:** `GET /api/tasks/:id/export.md` (`taskToMarkdown` in `server/src/taskExport.ts`) renders a task and its runs' transcripts as Markdown (outputs cut, thinking left out, about 350k characters at most); the Export button in `TaskPanel.tsx` is a plain download link. Never send it anywhere: it can contain output from the user's project. A restarted round-0 task whose branch already has the work is not an error (`runTask` checks `diffAgainstBase`), and its earlier summary is kept.
- **Checks section:** `GET /api/tasks/:id` returns `checks` (`taskChecks` in `routes.ts`): the project's verify commands matched by position to the steps of the task's latest `checks` run, status `passed` / `failed` / `stopped` (the user pressed Stop while it ran; `runChecks` marks the output `exit N (stopped)`) / `not_run`, no output. The UI (`ChecksPanel` in `TaskPanel.tsx`) fetches a failed step's output from `/api/runs/:id` on click. `runChecks` stops at the first failure, so later commands are `not_run`. Failed items carry `problem` when the output shows the command itself cannot run (`commandProblem` in `verifyHelp.ts`). `verifyHelp.ts` also backs `POST /api/projects/verify-help`: suggestions by project type (`suggestVerify`), install suggestions for the setup box (`suggestSetup`), and warnings for verify lines that cannot work in the folder or have no install step (`verifyWarnings`); they are only offered in the project form, never applied.
- **Env file for checks / setup failures:** `projects.checks_env_file` names a file in the project folder (validated by `validEnvFileName`, `orchestrator/envFile.ts`). `runChecks` copies it into the worktree as `projects.checks_env_target` (default `.env`, what apps read) with `placeEnvFile` and undoes that in `finally` (removes it, or restores the bytes of a file that was already there), so it exists only while no agent runs. `runChecks` returns `setupProblem` (from `setupProblem` in `verifyHelp.ts`: command cannot run, missing env variable); the pipeline then sets `needs_attention` at once with the reason instead of starting a fix round. The worker prompt says not to run or look for env files when `checks_env_file` is set.
- **Version and release notes:** `server/src/version.ts` reads the version from the root `package.json`, the short git commit, and `CHANGELOG.md`; `GET /api/version` returns them, the sidebar footer shows `v<version> · <commit>` and the Version page (`web/src/pages/VersionPage.tsx`) renders the notes (`## version (date)`, `### group`, `- item`). Add changes to a `## Unreleased` section at the top of `CHANGELOG.md` (the Version page shows it as is) and do not bump the version until the user asks for a release. When you release: rename `Unreleased` to the version and date, bump the version in the root, `server/` and `web/` `package.json` (`npm version X --no-git-tag-version` in each) and add the matching section at the top of `CHANGELOG.md`; a test fails when they differ.
- **Loop guard:** `engines/loopGuard.ts` (`LoopGuard`) is fed every tool result in `apiLoop.ts`. Failed `edit_file` / `write_file` calls count per tool and are reset only by a working call of the same tool, not by reads: warn at 3, stop at 6. The same failing call (same tool and input) warns at 3 and stops at 5. Other commands that fail with different input are never stopped by it. Thresholds are constants in that file.
- **Every agent call goes through `Orchestrator.callAgent`**: it records a `runs` row (model, tokens, cost, transcript), enforces the spending limits, and publishes activity. New kinds of agent work should use it, not call an engine directly.
- **Teams:** a project has a team, a chat can use another. No team = every enabled agent. Planner only assigns to its team's developers. Who plans: `pickPlanner` (`teams.ts`) takes `chats.planner_id`, then `projects.planner_id`, then the team's planner; it is read on every message, so a change applies at once. The chat header has the picker.
- **Scrum:** a project with `process = 'scrum'` hands chat messages to `Scrum.chat` (the planner acts as product manager). Items refine by themselves (product manager, architect, developer estimate) until Ready. `Scrum.start` creates the sprint branch and one queued task per item; sprint tasks start from the sprint branch, are reviewed against it, and squash-merge into it (`mergeIntoSprint`, serialized per sprint). sprint tasks whose `paths` overlap run in order: `tick` skips a queued task while a task of the sprint with overlapping paths is working (any id), or an earlier one (lower id = backlog priority) is not merged or cancelled (`blockingTask` in `orchestrator/overlap.ts`, one chat message per wait), and `cancel` ticks so a waiting task can start; `settle` completes the sprint when every task has merged; a task retried after the sprint closed (not yet released) still merges into the sprint branch: `Orchestrator.retry` puts its item back to `in_sprint`, and `Scrum.mergedLate` rewrites the notes; a retry after the release is refused; `release` merges the sprint branch into the base branch and pushes. Running-tasks tabs come from `TASK_GROUPS` in `routes.ts`: a merged sprint task is *done* until its sprint is released, then *released*. Usage per sprint attributes a run to `COALESCE(runs.sprint_id, item's sprint)`. The Scrum page (`web/src/pages/ScrumPage.tsx`) is list + detail with four tabs (Backlog, Coming PI, Current PI, Releases); which PI is coming or current is derived in the UI from its sprints (`groupsByTab`), there is no PI status for it. The two task views link to each other by hash: `#/tasks?group=…&task=ID` opens a task in Running tasks, `#/scrum/<project>?tab=…&sprint=ID[&task=ID]` opens a sprint or task on the Scrum page (`Route` in `App.tsx`); `/api/tasks` returns `sprint_number` and `sprint_status` for the back link.
- **Office** (`web/src/office/`): isometric canvas, no assets. `layout.ts` is pure (blocks per team or one open block, desks, lounge furniture, break `spots`, walking routes through the shared corridor; tested in `scene.test.ts`, including that routes never cross furniture or glass). `scene.ts` moves sprites and depth-sorts (`sortItems`), `props.ts` draws furniture, the invaders cabinet and slot machine (pure functions of time), `people.ts` characters, `logo.ts` the emblem. Features and logo are settings keys `office_*` and `logo_*` (defaults in `db.ts`); `/api/office` also returns teams with member ids. New furniture: add a rect to `layout.ts`, draw it in `props.ts`, add it to the route test's `rects`.
- **Demo engine** (`engines/demo.ts`) answers every tool the app uses, including the Scrum ones; extend it when you add a new tool, or the demo breaks.
- **Model guide ratings** are expectations unless marked "seen" (observed in real runs here). Do not mark a rating "seen" without evidence.

## Rules

- **Migrations:** never edit an applied one; append a new string to `MIGRATIONS`.
- **Secrets:** API keys are encrypted in the vault (`crypto.ts`); values never leave the server and are never printed, logged, committed or sent to the UI. Logs carry outcomes, not values.
- **Local only:** the server binds to 127.0.0.1 and refuses other hosts and cross-site writes. Keep it that way.
- **Git safety:** agents work in worktrees; the user's own checkout is not touched. Only branches this tool created (`task/...`) are deleted on a remote. Commands outside an agent's allow-list need the user's approval.
- **Tests that call the API** need a `host: localhost` header and a session cookie from `POST /api/auth/setup` (username of 3+ characters). Replace the engine with `engineOverride.engine`. See `test/pipeline.test.ts` and `test/scrum.test.ts`.
- **UI changes:** check with a real browser (Playwright is fine) in demo mode; type checks do not show layout problems.
- **Keep the repo generic:** no customer, employer or other-product names in code, docs, tests or commit messages.
- Update README.md (user manual) and this file in the same change when a concept moves.
- Commits: small, imperative subject, a body that says why.
