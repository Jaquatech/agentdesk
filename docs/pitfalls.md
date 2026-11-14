# Pitfalls

Things that cost real debugging time. Read the ones that touch your change before you start, and add one when something bites: a line with the cause and the rule, not the story.

## Database

- **Never edit an applied migration.** Append a new string to `MIGRATIONS` in `server/src/db.ts`.

## Agents and tasks

- **Every agent call goes through `Orchestrator.callAgent`.** It records the run, enforces spending limits and publishes activity. A direct engine call bypasses all three.
- **A round that changes nothing must not replace `tasks.summary`.** That text ends up in the merge commit and the release notes.
- **A restarted round-0 task whose branch already holds the work is not an error.** `runTask` checks `diffAgainstBase` first.
- **New agent tool: extend the demo engine** (`engines/demo.ts`) in the same change, or the demo breaks.
- **Loop guard counts failed edits per tool,** and only a working call of the same tool resets the count. Reads do not.

## Scrum

- **Sprint tasks with overlapping `paths` run in order.** Anything that ticks the queue must respect `blockingTask` in `orchestrator/overlap.ts`.
- **A retry after release is refused.** A retry after the sprint closed but before release merges into the sprint branch and rewrites the notes.

## Documents

- **Saving a task page copies its sections back onto the task without calling `updateTask`.** Calling it would sync the page again and loop.
- **`applyWikiWrites` never updates a General page.** Planner and developer writes go through it.

## Secrets and local access

- **Secret values never leave the server.** Not in logs, errors, the UI, exports or commits. Log outcomes.
- **Task export can contain output from the user's project.** It is a plain download link and is never sent anywhere.
- **The env file for checks exists only while no agent runs.** `runChecks` places it and removes it in `finally`; keep it that way.

## Tests

- **API tests need a `host: localhost` header and a session cookie** from `POST /api/auth/setup` (username of 3 or more characters).
- **UI changes need a real browser.** Type checks do not show layout problems.

## Versions

- **The version in the root, `server/` and `web/` `package.json` must match,** and the top `CHANGELOG.md` section must match it. A test fails otherwise.

## The office route test is slow
`walking routes` in `web/src/office/scene.test.ts` walks every desk to every spot and takes about 5 s on a busy machine, so the default 5 s test timeout failed it now and then (looked like a flaky test, was a timeout). It has an explicit 30 s limit; keep it when you add furniture, which makes it slower.

## Brand color as text
`--primary` is a dark amber made for button backgrounds. As text on the dark theme it measures about 2.5:1, below the 4.5:1 minimum, and the accessibility scan fails on it. Text, links and badge labels use `text-primary-text` (a lighter amber in dark, the same color in light). Do not use `text-primary` outside `components/ui/`.
