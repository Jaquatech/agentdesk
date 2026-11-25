# Release notes

## Unreleased

### Added
- Office: a draft beer tap and a kombucha machine in the lounge that idle agents pour from. Turn them off with "Beer and kombucha" in Settings > Office.
- Data factory: Runs tab to plan a run with a cost estimate, follow it live, stop it and read each model's answers.
- Projects have a Data factory switch. When it is on, the project shows a Data factory page in the sidebar.
- Data factory: import a dataset (JSONL, JSON or CSV), see problems and warnings, and keep each import as an immutable version.
- Data factory files are read in their real encoding: UTF-8 (with or without BOM), UTF-16, or Windows ANSI, so Nordic letters survive. The page says which one was used.
- Each dataset version remembers the name of the file it was imported from.
- Data factory: each project keeps a list of the models it tests and judges with.
- Data factory: Models tab with capabilities and prices for each model.
- Data factory: start a run and see each model's answers, tokens, cost and time; every call counts in Usage with the kind eval and toward the daily limit.
- Data factory: plan a run (dataset version, models, system prompt, answer cap, cost cap) with a cost estimate before anything is sent.

### Changed
- The Data factory sections are tabs in the page header like Scrum, with a narrow list on the left and a wide view. Replaces the side menu. Only Datasets is built; the other tabs are placeholders.
- The Datasets page opens the first dataset by itself, clears the form and old messages after an import, and shows times in local time.
- Import is its own tab in the Data factory; after an import the page opens the dataset in the Datasets tab.
- Picking a second file after typing a dataset name renames the dataset from the new file name, unless the name was typed again since the last pick.

### Changed
- The demo project has the Data factory on and a small sample dataset.

## 1.6.0 (2026-11-24)

### Added
- Attachment handling has a "Reading scans" card: the agent that should read scanned PDFs and photos, and a page cap per file.
- A scanned PDF (no text layer) is read once at upload by the chosen Reading scans agent, and the transcribed pages become its Markdown copy. Each read is one agent call, shown in Usage as kind `scan`. Off until an agent is chosen.
- The Version page lists the packages AgentDesk uses and their licences. `THIRD_PARTY_NOTICES.md` is generated from the lockfile, and CI fails when a licence is not on the allow-list or the file is stale.
- An agent that sees an image writes one short note about it in the same answer. The note is shown under the image and used in later messages instead of the image.
- Attachment limits are settings per file type (Markdown copy on or off, characters sent with the message, spreadsheet rows and columns, image size).
- Attachment handling page (sidebar group Platform settings): limits per file type.
- PDF pages can be rendered to PNG images (`@hyzyla/pdfium`, up to 50 pages, longest side 2000 px). Scan reading uses it.

### Changes
- CI runs `npm audit --omit=dev --audit-level=moderate`, so a production dependency with a moderate or worse finding fails the build. The four moderate findings in the dev-only `shadcn` tool stay accepted and are recorded in `docs/decisions.md`.
- The token efficiency rule is written down (`CLAUDE.md`, `docs/standards.md`), and the README has a Design choices section. No prompt or behaviour changed.
- Attachment handling: each box has its own Save button, and number fields can be cleared while typing.
- Attachment handling shows the boxes in two columns on wide screens.
- The sidebar group Team is now called Platform settings.
- Files you attach to a chat are copied to Markdown as you upload them. The original file is left as it is. CSV and TSV gain a short header that names the columns and counts the rows. Excel becomes one table per sheet (a sheet that is cut short says how many rows and columns were left out). Word keeps headings, paragraphs, lists and tables. A PDF with a text layer is copied page by page. A scanned PDF is marked as needing a text scan, and nothing is guessed. The planner and the product manager see the first part, about 20 000 characters, and can ask for the next part by the file's name. The message shows whether the copy was made. A file that cannot be read is marked failed, and the message still sends. Files on earlier messages stay as names, with the size and how many parts there are.
- **search_wiki** keeps words of two or more characters, so API, git, PI, SQL and CSS match, and it matches a whole word, so git does not match inside digit. Each result is a short snippet around the match. Pages are ranked by how many of the words match, a title or section match counts more than the body, and at most eight pages come back. A project page comes before a General page when the rank is the same.
- A chat summary that fails is not tried again on the next message. It waits until the window has moved on by half, and it stops after three failures. The chat still answers. Those automatic notes are marked in the project journal, and a prompt keeps at most ten of them, so they do not crowd out notes you or the planner wrote. Settings → **Agent for chat summaries** (next to **Messages sent from a chat**) can hand that three-line note to a smaller model. Leave it empty and the planner writes it. A small model is enough.
- A chat sends only the last few messages with each planner or product-manager reply. Settings → **Messages sent from a chat** sets how many (default 16, from 6 to 40). A smaller window costs fewer tokens. The wiki in each call is an index (title, section, first line, length). Agents open a page with **read_wiki** or **search_wiki**, including General pages, which stay read-only. Overview, Architecture and Setup stay written out for the architect and the developer. Claude CLI gets the index and Overview, because it has no custom tools. When a chat grows past the window, the planner writes a three-line note into the project journal once per window, not on every message. **New chat** says that the journal, the wiki index and the task list carry over, and that messages do not. The chat header shows the tokens used in that chat and a rough size of the last prompt.
- An unsent chat message stays in the box when you open another page, switch to Tasks or Office, or refresh the tab. Each chat keeps its own draft. Sending or clearing the box clears it. Coming back shows the messages straight away, and keeps your place in the list if you had scrolled up.
- In a Scrum chat the product manager receives the latest message's attachments the same way a planner does: images when the model can read them, and the first part of each file's Markdown copy. A file that cannot be sent (the model cannot read images, the copy failed, or the PDF has no text layer) is named with the reason, and that note is shown under the message. A backlog item created from the message records those file names on its request, so the architect knows they existed. The files themselves are not sent on.
- Each agent has a **Max answer tokens** setting next to Thinking (default 32 000, from 1024 to 128 000). Model calls use it instead of a fixed 8192. A model that rejects a higher limit is asked again with the limit it allows, and the task continues. When thinking uses the whole limit and there is no answer, the note names the agent's limit and suggests raising it or turning Thinking off. The hint under the field says the setting has no effect for Claude CLI agents. A value outside the range is explained under the field, including on a narrow window.
- Every agent working on a project can update that project's wiki pages (Overview, Architecture, Road map, Setup, Decisions, Release notes), including the planner, product manager, architect, reviewer and security reviewer, and including Scrum chat, refinement, notes and security review. A section written as "Road map" or "Overview.md" still lands on the right page, and a write that does not is told back to the agent. General pages stay unchanged. The Claude CLI returns the same wiki list in its result. In the demo, the live sprint task updates the project's Overview page.

### Fixed
- The approval banner clears right after you answer, and Cancel in the Always allow form works.
- Claude CLI agents are asked for `image_notes` when they are shown an image, as the API agents are, so a note is stored for later messages.
- The PDF card on Attachment handling no longer says scanned pages are not read.

### Maintenance
- `package-lock.json` is checked out with LF line endings, so a Windows checkout that converts text files to CRLF no longer shows the lockfile as modified after npm writes it.

## 1.5.0 (2026-11-14)

### Accessibility
- Found by a new scan of the approval banner: the Deny button was hard to read on the dark theme. It is now an outlined button with a red border. The scans also cover a form with a validation error and an open dropdown.
- An automated scan now checks every page in both themes. It found and fixed: the sidebar project list was not a valid list, links in text were told apart only by color (they are underlined now), the amber text and the green badge were too dim on the dark theme, the logo upload had no name, the model picker in the agent form had no name, links in dialogs were not underlined, the usage chart announced itself wrongly, and scrolling pages could not be reached by keyboard (they can now, with a focus ring).

### Documents
- Two new guides under General: **Engineering standards** (principles, ask-first list, stage gates, tests) and **UI guidelines**. They are written for any project, so agents can follow them everywhere. Your own edits to the other guides are left alone.

### Maintenance
- `shadcn` moved to development dependencies; a production dependency audit reports no issues.
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
