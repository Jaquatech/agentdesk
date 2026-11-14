# Release notes

## Unreleased

### Accessibility
- An automated scan now checks every page in both themes. It found and fixed: the sidebar project list was not a valid list, links in text were told apart only by color (they are underlined now), the amber text and the green badge were too dim on the dark theme, the logo upload had no name, the model picker in the agent form had no name, links in dialogs were not underlined, the usage chart announced itself wrongly, and scrolling pages could not be reached by keyboard (they can now, with a focus ring).

### Maintenance
- All lint warnings are fixed and the limit is now zero. Unused code is removed, provider, task export and Scrum code use real types instead of `any`, and effects that load data are written so their dependencies are checked.

### Demo
- The first demo start adds a fictional Mars-gadget startup (team, agents, a small git project with a backlog), so every page has something to show. Test connection and model info answer instantly in demo mode.
- `npm run demo:reset` stops a leftover demo server and clears the demo data (on Windows the old server could keep the database locked).
- Browser tests (`npm run e2e`) run the app in a real browser against the demo data, and CI runs them. Orbit, the demo developer, no longer asks before commands, so the active sprint runs without waiting for you. A browser test walks the full flow: a task merges, a retried task asks for approval, the sprint is released.

### Changes
- The app loads faster: pages (Office, Documents, Scrum, Chat and the rest) are fetched when you first open them, so the first download is about half the size (120 kB instead of 234 kB compressed).
- Cleaner effects in the web app: values that depend on a choice (theme, provider models, project folder checks, usage period, mobile layout) are now derived instead of reset in an effect. No change in what you see.
- Development tools: ESLint is now on version 10, and the audit warnings for the lint tools are cleared (6 remain, all in the build-time `shadcn` command-line tool).
- Keyboard and screen-reader fixes: backlog items in Scrum open from their title with the keyboard, the "Sprint" back link is a real button, a task's check rows open and close with Enter or Space, the days in the Usage chart can be reached with Tab, and the message box in Chat is labelled.
- Added the project's engineering standards, stage gates, decisions and pitfalls under `docs/`. No change to how the app behaves.
- The server now sends a Content-Security-Policy and related security headers. The UI loads only from its own origin; images in Markdown that point to other sites are not shown.
- Pressing Enter to send a chat message or add a project note no longer fires while you are composing text with an input method (Japanese, Chinese, Korean).
- With the system setting "reduce motion" on, the isometric office is a still picture and UI animations are switched off.
- Added ESLint and a GitHub Actions workflow that runs lint, tests and build on every push and pull request.

## 1.4.0 (2026-11-12)

### Changes
- The web UI now uses shadcn/ui and Tailwind. The theme is preset `b1a09SuFE`: stone surfaces, amber primary, blue charts, Roboto. Dark mode is the default. A theme control in the sidebar (and on the sign-in screen) switches to the light stone theme. The isometric office is unchanged.
- Long forms (agent, project, team, and the other app dialogs) are about 100px wider. Confirmations stay compact.
- The Checks box on a task no longer clips the command and its result. The card was shrinking inside the task pane and hiding that line.
- **Documents** replaces Guides. Pages are stored in the local database.
- Documents is a wiki. **General** holds Coding guidelines, Choosing AI models, and Development cycle. Each project has Overview, Architecture, Decisions, Road map, Release notes, Setup, and a page per task. A task page stays in step with the task's spec, summary, and review. Pages can link to each other. The planner and a developer read that project's pages and can update them. General pages stay free of project names. Upload is not in this version.
- Opening another page in Documents no longer jumps the list back to the top. A refresh of the page you are reading keeps your place.
- Vite is 8.3.8 and `@vitejs/plugin-react` is 6.3.0. React stays on 19.3.1, the latest stable.

### Fixes
- **Release notes now appear in Documents.** Each sprint's release notes are a page under the project's Release notes section, created when the notes are written and refreshed when they are written again. Sprints released before this version get their page the next time the server starts. Editing the page edits the sprint's release notes.

## 1.3.2 (2026-11-11)

### Changes
- **Planner picker in the chat.** The chat header has a Planner selector next to Team; the choice applies to the next message. A project can also have its own planner (Projects form). Order: chat, then project, then the team's planner. Before, changing the planner in a team or in Settings could leave a chat on the old one.
- Release notes now collect under **Unreleased** until a release is made, so the version number no longer goes up with every small fix.

## 1.3.1 (2026-11-08)

### Fixes
- A check that was cut off because you pressed **Stop** is now shown as **stopped** instead of "failed (exit 1)". It is not counted as a failure, and nothing is sent back to the developer.

## 1.3.0 (2026-11-08)

### Tasks
- **Export:** an **Export** button on every task downloads it as one Markdown file: the task, its problem, summary, review and spec, and every round with each tool call and its result. For bug reports and for handing a task to a reviewer. It can contain output from your project: read it before you share it.

### Fixes
- A task that is stopped and restarted after its work was already committed no longer fails with "The worker made no changes". Finding nothing left to do is fine when the work is on the branch, and the summary of what was done is kept.

## 1.2.3 (2026-11-08)

### Fixes
- A restarted task no longer starts beside a task that is already working on the same files: it waits for it. Before, only tasks higher in the backlog were waited for, so stopping one task and restarting it while the other had started could run both at once.

## 1.2.2 (2026-11-08)

### Scrum
- A queued task that waits for another one (same files) now says so in the task view: "Waiting for <task> (<developer>) to finish", and warns when that task has stopped and needs a retry.

## 1.2.1 (2026-11-08)

### Fixes
- A task that waits for another one (same files) now says so once in the sprint chat, instead of again every time the other task changes status.

## 1.2.0 (2026-11-08)

### Scrum
- **Tasks that change the same files now run one after the other.** Before, two items of a sprint that both touched the README started at the same time: the second could not see the first one's work and either did nothing or conflicted. Now the later task waits (and says so in the sprint chat), then starts from the sprint branch with the earlier work in it. Tasks on different files still run in parallel.

## 1.1.2 (2026-11-08)

### Fixes
- The task summary (shown on the task, in the merge commit and in the release notes) now keeps what the earlier rounds did. Before, a last round that changed no files replaced it with "no file changed in this round".

## 1.1.1 (2026-11-08)

### Fixes
- **Scrum:** a task that is retried after its sprint closed now marks its backlog item done and rewrites the sprint's release notes, instead of leaving "Nothing was merged" and the item back in the backlog.
- A task of a sprint that is already released can no longer be retried (its branch is gone); plan the item again from the backlog.

## 1.1.0 (2026-11-08)

### Checks
- New **Checks** section in the task view, by Merge and as a chip at the top of the task: every verify command with its result. Open a failed one to see its output.
- A check that cannot run (missing npm script, no package.json, command not found) says so, instead of looking like a code failure.
- The Checks section shows "waiting" until the build is done.

### Safer, less wasteful agents
- **Loop guard:** an agent that keeps repeating a failing edit or the same failing call is warned and then stopped, even when it reads files in between.
- A check that fails because of the project setup (missing environment variable, missing script, command not found) stops the task at once with the reason, instead of starting new fix rounds.

### Project setup
- **Verify suggestions:** buttons for commands that fit the folder (npm scripts that exist, pytest, go, cargo, dotnet, `git diff --check`), plus warnings for commands that cannot work there.
- **Setup suggestions:** install buttons (npm ci, pnpm, yarn, pip) and a warning when nothing installs the packages.
- **Env file for checks:** copy a file such as `.env.demo` into the worktree as `.env` (setting **Copy as**) only while the verify commands run, then remove it. Agents never see it.

### Other
- This **Version** page and the version in the sidebar.

## 1.0.0 (2026-11-07)
- First release.
