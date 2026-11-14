# Decisions

One line per decision, with the reason, so nobody raises it again. Add to it at every gate (see `standards.md`).

## Settled

- **No automatic formatter for now.** The code uses semicolons, double quotes and long lines, one component per file. A formatter would rewrite most files and bury real changes in diffs. Revisit as its own single "format everything" commit if the style starts to drift.
- **We do not use the UI SDK library.** Radix through shadcn already provides focus, keyboard, dismissal and ARIA. Revisit if a primitive we need is missing or wrong.
- **The isometric office is outside the shadcn system.** It is canvas drawing; its chrome CSS stays hardcoded at the bottom of `styles.css`.
- **Models, agents and tool output are untrusted.** They are shown as text or sanitized Markdown and never as raw HTML.

- **Lint is a ratchet.** ESLint (typescript-eslint, react-hooks, jsx-a11y) runs with `--max-warnings` set to today's count, so existing issues are warnings and any new one fails CI. When you fix warnings, lower the number in the root `package.json` `lint` script. Generated shadcn files in `web/src/components/ui/` are not linted.

## Known and open

- 206 lint warnings from before the rules: 142 `any`, 16 hook dependency lists, 11 state set inside an effect, 3 ref read during render, 14 accessibility (labels without a control, clickable non-buttons, an anchor used as a button, one autofocus), 20 unused or style items. Fix them page by page when touching it, and lower the cap.

- `ScrumPage.tsx` is about 590 lines. Split it into list, detail and tab logic when it is next changed.
- The web side has one test file. Add role-based browser checks in demo mode for the main flows, with an automated accessibility check per page.
- Enter-to-submit in `ChatPage.tsx` and `ProjectsPage.tsx` ignores text composition: not yet (breaks Japanese, Chinese and Korean input).
- The server sends no Content-Security-Policy; only attachments get `nosniff`.
- Reduced motion is not handled; the office canvas animates continuously.
- Continuous integration runs lint, tests and build, but nothing yet runs the app in a browser.
