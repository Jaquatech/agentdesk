# AgentDesk: map for worker agents

Local-only tool: Fastify server (`server/`, `node:sqlite`), React + shadcn UI (`web/`). CLAUDE.md has the full rules and
code map; read it by line range, only the parts your task touches. Tests: vitest (`npx vitest run --root server <file>`
or `--root web <file>`). Use targeted tests while working; the full `npm test` has known slow tests.

## Rules that matter for every task
- Only change the files in the task's `paths`. One task = one branch = one PR.
- No new dependencies, no edits to `package.json` / `package-lock.json`, no version bump.
- Notes go under `## Unreleased` in CHANGELOG.md (create `### Fixed` / `### Added` there when needed).
- Migrations: never edit an applied one; append to `MIGRATIONS` in `server/src/db.ts`.
- Secrets never leave the server: do not print, log or commit API keys or `.env` values.
- Model, agent, repo and tool output is text or sanitized Markdown, never HTML.
- Do not touch `web/src/office/`. UI uses components from `web/src/components/ui/`; do not hand-roll focus or ARIA.
- Customer, employer or other-product names do not belong in code, docs, tests or commits.

## Where things are
| Concept | Where |
|---|---|
| Routes | `server/src/routes.ts` |
| Schema (append-only) | `server/src/db.ts` |
| Task pipeline, planner, approvals | `server/src/orchestrator/` |
| Scrum | `server/src/scrum.ts` |
| Documents (wiki) | `server/src/documents.ts` |
| UI pages / shared components | `web/src/pages/`, `web/src/components/` |
| Pure UI helpers (with tests) | `web/src/lib/` |
