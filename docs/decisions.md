# Decisions

One line per decision, with the reason, so nobody raises it again. Add to it at every gate (see `standards.md`).

## Settled

- **No automatic formatter for now.** The code uses semicolons, double quotes and long lines, one component per file. A formatter would rewrite most files and bury real changes in diffs. Revisit as its own single "format everything" commit if the style starts to drift.
- **We do not use the UI SDK library.** Radix through shadcn already provides focus, keyboard, dismissal and ARIA. Revisit if a primitive we need is missing or wrong.
- **The isometric office is outside the shadcn system.** It is canvas drawing; its chrome CSS stays hardcoded at the bottom of `styles.css`.
- **Models, agents and tool output are untrusted.** They are shown as text or sanitized Markdown and never as raw HTML.
- **The server sends a strict CSP and related headers** (`server/src/securityHeaders.ts`). The UI loads only from its own origin, so images in Markdown that point to other sites are not shown. That is intended: it stops tracking pixels and data leaving through a model's output. The page has no inline scripts (the theme script is `web/public/theme-init.js`).

- **Lint is a ratchet.** ESLint (typescript-eslint, react-hooks, jsx-a11y) runs with `--max-warnings` set to today's count, so existing issues are warnings and any new one fails CI. When you fix warnings, lower the number in the root `package.json` `lint` script. Generated shadcn files in `web/src/components/ui/` are not linted.

- **Dependency overrides in the root `package.json`.** ESLint is on 10; `eslint-plugin-jsx-a11y` only declares support for 9, so it is allowed through an override (it works; remove the override when the plugin adds 10). `minimatch` is forced to 11 only under `@typescript-eslint/typescript-estree` and `@ts-morph/common` to clear an advisory; a global override breaks the accessibility plugin, which needs the old one.
- **Accepted audit findings: 6 (2 low, 4 moderate), all inside the `shadcn` command-line tool** (`deepmerge`, `ts-morph` with an old `minimatch`). No fixed `deepmerge` exists (4.3.1 is the latest). They are build-time only and not part of the running app. A stale nested `minimatch` under `@ts-morph/common` can probably be cleared by regenerating the lockfile, but a full regeneration dropped the TypeScript 7 platform package and broke the build, so the lockfile is changed incrementally only. Run `npm audit` before a release.

## Known and open

- Lint has no warnings left and the cap in `package.json` is 0, so a new warning fails CI. `any` is allowed in test files only (parsed JSON and loose fixtures). In `src` three places keep `any` on purpose, each with a comment saying why: the database rows (`db.ts`), request bodies (`Body` in routes, teams and Scrum) and the tool input from the model (`runTool`). Hook rules: effects keyed on a computed string or a caller's list carry a comment saying why.
- `npm audit` (checked at the Gate 3 run after v1.4.0) reports 4 moderate and 2 low findings, all from the `shadcn` command-line tool in `web/package.json` (an old `deepmerge`, and `minimatch` under `ts-morph`). The tool only adds components at development time and its code does not run in the app or the server, so there is no exposure for users. Left as is: moving it to devDependencies or updating it (`npm audit fix --force` would install shadcn 1.0.0, a breaking change) is a dependency decision for the owner. The root `overrides` for `minimatch` also does not match what `ts-morph` installs (`npm ls` shows it as invalid); harmless today, to be tidied with that dependency work.

- `pages/scrum/Sprints.tsx` is about 280 lines and holds four views (PI, sprint, task, plan); split it if it grows.
- Browser checks (`e2e/`, Playwright, run by CI) cover page loads, the seeded data, one keyboard flow, the sprint flow end to end (approval, merge, release) and an automated accessibility scan (axe, WCAG 2.0/2.1 A and AA) of every page in both themes. The scan sees only a part of the problems. Besides every page it opens nine states (project, agent, provider, team and backlog-item dialogs, the agent gallery, a task needing attention, the chat). Not scanned yet: forms showing validation errors, open dropdowns and the approval banner. Still to add: those, and more flows (approvals, Merge, release).
- The accessibility scan skips the tab buttons (`[role="tab"]`): Radix points them at panels (`aria-controls`) that these pages do not render, since the tabs only switch what the page shows below. Fix by rendering a panel per tab, or by dropping the attribute.
- The CSP allows inline styles (`style-src 'unsafe-inline'`) because Radix injects style elements. Tighten with a nonce if that changes.
- With reduced motion the office is a still picture: agents do not walk to a new place when their state changes until the page is reloaded (labels and bubbles still update).
