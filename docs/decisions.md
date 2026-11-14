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

- 182 lint warnings from before the rules: 142 `any`, 16 hook dependency lists, 1 state set inside an effect (Providers form, loads on open), 3 ref read during render, 20 unused or style items. Fix them page by page when touching it, and lower the cap. The accessibility rules (jsx-a11y) have no warnings left.

- `ScrumPage.tsx` is about 590 lines. Split it into list, detail and tab logic when it is next changed.
- The web side has one test file. Add role-based browser checks in demo mode for the main flows, with an automated accessibility check per page.
- The CSP allows inline styles (`style-src 'unsafe-inline'`) because Radix injects style elements. Tighten with a nonce if that changes.
- With reduced motion the office is a still picture: agents do not walk to a new place when their state changes until the page is reloaded (labels and bubbles still update).
- Continuous integration runs lint, tests and build, but nothing yet runs the app in a browser.
