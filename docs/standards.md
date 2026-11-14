# Standards and stage gates

How we build AgentDesk. Getting the work done comes first; the gates check it. Usability comes first among the qualities, security right after it: people trust this tool with their code and keys.

Sources of the ideas (ideas only, no code copied): the UI SDK project from Vercel Labs (how an expert team writes and reviews code) and Modern Web Guidance from the Chrome team (current browser platform practice).

## Principles

1. **Use the layer that already exists.** Focus, keyboard, dismissal and ARIA come from `web/src/components/ui/` (Radix through shadcn), or from the browser. A page never hand-rolls a dialog, menu, popover, tabs, tooltip or focus trap. If a primitive is missing, add it with shadcn first.
2. **Find the twin.** Before writing, open the existing file that does the same job well and copy its shape, names and order.
3. **Decisions are pure, effects sit at the edge.** Logic goes in small functions with plain inputs and unit tests. DOM, network and database calls call them.
4. **Every convention gets a check** once a script can check it. A rule kept only in memory gets broken.
5. **Pass means exit code 0.** Never judge a check by reading its output.
6. **A fix comes with the test that fails without it.**
7. **Measure before optimizing,** and say what was measured.
8. **Ask first** before: a new dependency, a new migration shape, anything touching secrets, host checks, git safety or the vault, a change to a principle in this file.

## Twins

| Writing | Start from |
|---|---|
| A page with list and detail | `web/src/pages/DocumentsPage.tsx` |
| A form | `web/src/pages/ProjectsPage.tsx` with `components/inputs.tsx` and `ui/field.tsx` |
| Pure logic with tests | `web/src/office/layout.ts` with `scene.test.ts`; `server/src/verifyHelp.ts` |
| An API route and its test | `server/src/routes.ts` with `server/test/pipeline.test.ts` |
| A schema change | append a string to `MIGRATIONS` in `server/src/db.ts` |
| New agent work | through `Orchestrator.callAgent`, never an engine directly |

## Code

- Readable first, then fast, never clever.
- React 19 idiom: pure render, `ref` as a prop, no effect where an event handler or a derived value belongs.
- Names in full words. Booleans read as questions (`isOpen`, `hasValue`).
- Comments are rare. Write one only when a reader would get the code wrong without it (a browser bug, a trade-off, an external rule), in three lines or fewer. No comment says what the next line does, narrates history, or acts as a section banner.
- No defensive code for cases the types rule out. Narrow `unknown` at the boundary: API responses, model output, files, tool results.
- No helper with one caller, no option nobody passes, no dead code, no leftover logs.
- Split a file at about 500 lines or when it holds two ideas.

## UI and usability

- Every flow works with the keyboard alone, and focus returns to where the user was when a dialog closes.
- Status that changes without a user action (task state, agent activity, errors, toasts) is announced to assistive technology.
- Forms validate after the user has interacted with a field, and say what to do, not only what is wrong.
- Enter-to-submit ignores key presses that belong to text composition (`event.isComposing`).
- The tool is for beginners. Every empty state says what to do next. Every error gives the cause and one fix.
- Respect OS settings: dark and light, text scale, reduced motion, contrast.
- Long lists and transcripts must stay responsive; check with real data sizes.
- **Before any UI task, check current web platform guidance** (`npx -y modern-web-guidance@latest search "<2-5 word capability>"`, then `retrieve`), then adapt the idea to React and shadcn. Skip it for backend, tooling and copy changes.
- **Browser policy:** Baseline Widely available features are used freely. Newer features only with feature detection, graceful degradation and a fallback of about 20 lines or fewer, with no new dependency.

## Security

The rules in `CLAUDE.md` stay: local only, vault-encrypted secrets, worktree-only git, approvals, task export never sent anywhere. Added here:

- **Everything from a model, an agent, a repository file or a tool result is untrusted input.** It is rendered as text or sanitized Markdown, never as HTML, and never decides a file path, command or URL without validation.
- **Defense in depth in the browser:** the server sends a strict Content-Security-Policy, `frame-ancestors 'none'`, `nosniff` and `Referrer-Policy: no-referrer`.
- **The UI makes no outbound calls.** Fonts and icons are bundled. Links to other sites use `rel="noopener noreferrer"`.
- **A new dependency is a security decision.** Prefer the platform. Packages are pinned through the lockfile.
- **Data leaves the machine only to the model provider the user chose,** and the UI says so where that happens.

## Stage gates

A gate is a short checklist. Pass it by exit codes and by looking.

**Gate 0, start.** The task is one sentence a user would recognise. The twin is open. For UI work, guidance is searched. Anything on the ask-first list is raised before coding.

**Gate 1, works.**
- `npm run lint`, `npm test` and `npm run build` exit 0.
- A fix has the test that fails without it.
- A UI change is checked in a real browser in demo mode, by keyboard, in dark and light.

**Gate 2, clean (before commit).**
- Read the whole diff cold, as a strict reviewer and as a newcomer.
- Remove generated-looking code: comments that restate code, banners, hedge words, checks the types rule out, one-caller helpers, vague names (`data`, `result`, `temp`), options nobody passes, logs. Behavior and public names do not change, and the same tests pass before and after.
- README, `CLAUDE.md` and `## Unreleased` in `CHANGELOG.md` are updated in the same change when a concept moved.
- No customer, employer or other-product names anywhere.

**Gate 3, release ready (when a release is asked for).**

| Lens | Checks |
|---|---|
| Usability | A beginner can finish the main flows in demo mode without the manual. Empty and error states read well. Keyboard and screen-reader pass on changed pages. Reduced motion is respected. |
| Security | Re-read the secrets, local-only and git-safety rules against the diff since the last release. New inputs are treated as untrusted. No Content-Security-Policy violations in the browser console. No new outbound calls. Dependency changes reviewed. |
| Platform | `npx -y modern-web-guidance@latest legacy-scan web/src` run and each finding verified (it covers only part of the guidance). Guidance checked for each new UI pattern. No hand-rolled behavior. |
| Project knowledge | `CLAUDE.md` rules held, migrations append-only, the demo engine answers every new tool, versions match. |

Every finding ends in one of three places in the same session: fixed with its test, listed under Known and open in `docs/decisions.md`, or listed under Settled there with the reason, so it is not raised again. A mistake that cost real debugging time gets a line in `docs/pitfalls.md`.

## Deliberately not adopted

- The UI SDK library itself: it is in beta and Radix fills that role. Revisit if a needed primitive is missing or wrong.
- Library concerns: zero runtime dependencies, server rendering, right-to-left, multi-framework parity, public API stability tags.
- That project's style choices (no semicolons, export placement, no return types). See `docs/decisions.md` for the formatter decision.
- Web guidance that does not fit a local single-user tool: passkeys, payment and address autofill, installable web app, preloading the next page, cross-document transitions, built-in browser AI, WebMCP, WebAssembly.
