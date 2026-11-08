# Release notes

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
