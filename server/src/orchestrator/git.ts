import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProgram, tail } from "./shell.ts";

export type ProjectRow = {
  id: number; name: string; source: "local" | "github" | "azure"; path: string; repo_url: string;
  base_branch: string; shell: string; setup: string; verify: string; allowed_paths: string; context: string;
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await runProgram("git", args, { cwd, timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed:\n${tail(r.stderr || r.stdout, 15)}`);
  return r.stdout.trim();
}

async function gitOk(cwd: string, ...args: string[]): Promise<boolean> {
  return (await runProgram("git", args, { cwd, timeoutMs: 60_000 })).code === 0;
}

async function hasRemote(cwd: string): Promise<boolean> {
  return (await runProgram("git", ["remote", "get-url", "origin"], { cwd })).code === 0;
}

/** Makes sure the project folder exists; GitHub / Azure DevOps projects are cloned on first use. */
export async function ensureProjectCheckout(p: ProjectRow): Promise<void> {
  if (existsSync(join(p.path, ".git"))) return;
  if (p.source === "local") throw new Error(`${p.path} is not a git repository (run \`git init\` there first)`);
  if (!p.repo_url) throw new Error("Project has no repository URL");
  mkdirSync(p.path, { recursive: true });
  await git(p.path, "clone", p.repo_url, ".");
}

/** `startPoint`: a local branch to start from (a sprint branch) instead of the project's base branch. */
export async function ensureWorktree(p: ProjectRow, worktreeRoot: string, slug: string, fresh = false, startPoint?: string) {
  const branch = `task/${slug}`;
  const wt = join(worktreeRoot, `${p.id}-${slug}`);
  const remote = await hasRemote(p.path);
  if (remote) await git(p.path, "fetch", "origin", "--quiet");
  const branchExists = await gitOk(p.path, "rev-parse", "--verify", "--quiet", branch);
  if (fresh && existsSync(wt)) {
    await git(p.path, "worktree", "remove", "--force", wt);
    if (branchExists) await git(p.path, "branch", "-D", branch);
  }
  if (!existsSync(wt)) {
    mkdirSync(worktreeRoot, { recursive: true });
    await git(p.path, "worktree", "prune");
    if (branchExists && !fresh) await git(p.path, "worktree", "add", wt, branch);
    else await git(p.path, "worktree", "add", "-b", branch, wt, startPoint ?? (remote ? `origin/${p.base_branch}` : p.base_branch));
  }
  return { wt, branch };
}

// ---------- sprint branches ----------

/** Creates the sprint branch from the base branch (the remote's latest when there is one). */
export async function createSprintBranch(p: ProjectRow, branch: string) {
  const remote = await hasRemote(p.path);
  if (remote) await git(p.path, "fetch", "origin", "--quiet").catch(() => "");
  const from = remote && (await gitOk(p.path, "rev-parse", "--verify", "--quiet", `origin/${p.base_branch}`)) ? `origin/${p.base_branch}` : p.base_branch;
  if (await gitOk(p.path, "rev-parse", "--verify", "--quiet", branch)) throw new Error(`Branch ${branch} already exists`);
  await git(p.path, "branch", branch, from);
}

/** A worktree on the sprint branch: where approved tasks are merged and where the security review reads. */
export async function ensureSprintWorktree(p: ProjectRow, worktreeRoot: string, sprintId: number, branch: string) {
  const wt = join(worktreeRoot, `${p.id}-sprint-${sprintId}`);
  if (!existsSync(wt)) {
    mkdirSync(worktreeRoot, { recursive: true });
    await git(p.path, "worktree", "prune");
    await git(p.path, "worktree", "add", wt, branch);
  }
  return wt;
}

/** Brings the sprint's latest work into a task branch so the task is built and reviewed on top of it. */
export async function syncBranch(wt: string, from: string) {
  if (await gitOk(wt, "merge-base", "--is-ancestor", from, "HEAD")) return;
  const r = await runProgram("git", ["-c", "user.name=AgentDesk", "-c", "user.email=agentdesk@localhost", "merge", "--no-edit", from], { cwd: wt, timeoutMs: 120_000 });
  if (r.code !== 0) {
    const files = (await runProgram("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: wt })).stdout.trim().split("\n").filter(Boolean);
    await runProgram("git", ["merge", "--abort"], { cwd: wt });
    throw new Error(`The sprint branch changed the same lines as this task${files.length ? ` (${files.join(", ")})` : ""}. Resolve it by hand or retry after the other tasks are done.`);
  }
}

/** Squash-merges an approved task branch into the sprint worktree. Returns false when it conflicts (nothing is changed). */
export async function squashInto(sprintWt: string, taskBranch: string, message: string): Promise<{ ok: boolean; conflicts: string[] }> {
  const r = await runProgram("git", ["merge", "--squash", taskBranch], { cwd: sprintWt, timeoutMs: 120_000 });
  if (r.code !== 0) {
    const conflicts = (await runProgram("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: sprintWt })).stdout.trim().split("\n").filter(Boolean);
    await runProgram("git", ["reset", "--hard", "HEAD"], { cwd: sprintWt });
    return { ok: false, conflicts };
  }
  if ((await git(sprintWt, "status", "--porcelain")).trim()) {
    await git(sprintWt, "-c", "user.name=AgentDesk", "-c", "user.email=agentdesk@localhost", "commit", "-q", "-m", message);
  }
  return { ok: true, conflicts: [] };
}

export async function branchLog(p: ProjectRow, branch: string, base: string) {
  const remote = await hasRemote(p.path);
  const ref = remote && (await gitOk(p.path, "rev-parse", "--verify", "--quiet", `origin/${base}`)) ? `origin/${base}` : base;
  return git(p.path, "log", "--format=%h %s", `${ref}..${branch}`).catch(() => "");
}

/**
 * Release: merges the sprint branch into the base branch (a merge commit, so the sprint stays visible in history) and
 * pushes it when the project has a remote. The project folder must be clean and on the base branch.
 */
export async function releaseSprint(p: ProjectRow, branch: string, message: string, push: boolean): Promise<string> {
  const current = await git(p.path, "rev-parse", "--abbrev-ref", "HEAD");
  if (current !== p.base_branch) throw new Error(`Project folder is on ${current}; switch it to ${p.base_branch} first`);
  if ((await git(p.path, "status", "--porcelain")).trim()) throw new Error("Project folder has uncommitted changes");
  const remote = await hasRemote(p.path);
  if (remote) await git(p.path, "pull", "--ff-only", "--quiet").catch(() => "");
  const r = await runProgram("git", ["-c", "user.name=AgentDesk", "-c", "user.email=agentdesk@localhost", "merge", "--no-ff", "-m", message, branch], { cwd: p.path, timeoutMs: 120_000 });
  if (r.code !== 0) {
    await runProgram("git", ["merge", "--abort"], { cwd: p.path });
    throw new Error(`Merging ${branch} into ${p.base_branch} failed (${base_conflict(r.stdout + r.stderr)}). ${p.base_branch} changed since the sprint started; merge it into the sprint branch by hand.`);
  }
  // Exit code 0 is not proof: a merge that got the wrong arguments says "Already up to date". The sprint must really be in.
  if (!(await gitOk(p.path, "merge-base", "--is-ancestor", branch, "HEAD"))) {
    throw new Error(`${branch} is not in ${p.base_branch} after the merge. Nothing was released; the sprint branch is kept.`);
  }
  if (push && remote) {
    const pr = await runProgram("git", ["push", "origin", p.base_branch], { cwd: p.path, timeoutMs: 5 * 60_000 });
    if (pr.code !== 0) return `Merged into ${p.base_branch} here, but the push failed: ${tail(pr.stderr || pr.stdout, 4)}`;
    const head = await git(p.path, "rev-parse", "HEAD");
    const remoteHead = await git(p.path, "rev-parse", `origin/${p.base_branch}`).catch(() => "");
    if (head !== remoteHead) return `Merged into ${p.base_branch} here, but origin/${p.base_branch} does not match it (not pushed)`;
    return `Merged into ${p.base_branch} and pushed`;
  }
  return `Merged into ${p.base_branch}${remote ? " (not pushed)" : ""}`;
}
const base_conflict = (text: string) => tail(text, 3).replace(/\s+/g, " ");

export async function deleteBranch(p: ProjectRow, branch: string) {
  await git(p.path, "branch", "-D", branch).catch(() => "");
}

export async function changedFiles(wt: string): Promise<string[]> {
  // -z: no quoting, and the raw output keeps the leading status column (git() would trim it).
  const r = await runProgram("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: wt });
  if (r.code !== 0) throw new Error(`git status failed: ${tail(r.stderr, 5)}`);
  const entries = r.stdout.split("\0");
  const files: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    files.push(e.slice(3));
    if (e[0] === "R" || e[0] === "C") i++; // the next entry is the old name of a rename/copy
  }
  return files;
}

/** True when the file is under one of the allowed folders/files (empty list = everything allowed). */
export function pathAllowed(file: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const f = file.replace(/\\/g, "/");
  return allowed.some((a) => {
    const p = a.replace(/\\/g, "/").replace(/^\.\//, "");
    return p.endsWith("/") ? f.startsWith(p) : f === p || f.startsWith(p + "/");
  });
}

/** Commits the worker's changes. Refuses when a file lies outside the task's paths. */
export async function commitChanges(wt: string, message: string, allowed: string[]) {
  const files = await changedFiles(wt);
  if (!files.length) return { committed: false, files, outside: [] as string[] };
  const outside = files.filter((f) => !pathAllowed(f, allowed));
  if (outside.length) return { committed: false, files, outside };
  await git(wt, "add", "-A");
  await git(wt, "-c", "user.name=AgentDesk", "-c", "user.email=agentdesk@localhost", "commit", "-q", "-m", message);
  return { committed: true, files, outside };
}

export async function headSha(wt: string, short = true) {
  return git(wt, "rev-parse", ...(short ? ["--short"] : []), "HEAD");
}

export async function diffAgainstBase(wt: string, base: string, remote: boolean) {
  const ref = remote ? `origin/${base}` : base;
  return git(wt, "diff", "--stat", `${ref}...HEAD`);
}

export async function projectHasRemote(p: ProjectRow) {
  return hasRemote(p.path);
}

function bodyFile(text: string) {
  const f = join(tmpdir(), `agentdesk-pr-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(f, text, "utf8");
  return f;
}

/** Pushes the branch and opens (or comments on) a pull request. Returns the PR URL when known. */
export async function pushAndOpenPr(p: ProjectRow, wt: string, branch: string, title: string, body: string): Promise<string> {
  if (!(await hasRemote(p.path))) return "";
  await git(wt, "push", "-u", "origin", branch);
  const file = bodyFile(body);
  try {
    if (p.source === "github") {
      const view = await runProgram("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"], { cwd: wt });
      if (view.code === 0 && view.stdout.trim()) {
        await runProgram("gh", ["pr", "comment", branch, "--body-file", file], { cwd: wt });
        return view.stdout.trim();
      }
      // Opened only after QA approved the task, so it is ready for review (a draft cannot be merged).
      const r = await runProgram("gh", ["pr", "create", "--base", p.base_branch, "--head", branch,
        "--title", title, "--body-file", file], { cwd: wt });
      if (r.code !== 0) throw new Error(`gh pr create failed: ${tail(r.stderr, 5)}`);
      return r.stdout.trim().split(/\s+/).pop() ?? "";
    }
    if (p.source === "azure") {
      const r = await runProgram("az", ["repos", "pr", "create", "--source-branch", branch, "--target-branch",
        p.base_branch, "--title", title, "--description", body.slice(0, 3900), "--draft", "false",
        "--detect", "true", "--output", "tsv", "--query", "url"], { cwd: wt });
      return r.code === 0 ? r.stdout.trim() : "";
    }
    return "";
  } finally {
    rmSync(file, { force: true });
  }
}

export async function prComment(p: ProjectRow, wt: string, branch: string, body: string) {
  if (p.source !== "github") return;
  const file = bodyFile(body);
  try { await runProgram("gh", ["pr", "comment", branch, "--body-file", file], { cwd: wt }); }
  finally { rmSync(file, { force: true }); }
}

/**
 * Merges a finished task. GitHub: squash-merge the PR. Local / no remote: squash-merge the branch into the
 * base branch in the project folder (which must be clean and on the base branch).
 */
export async function mergeTask(p: ProjectRow, wt: string, branch: string, message: string): Promise<string> {
  if (p.source === "github" && (await hasRemote(p.path))) {
    // PRs opened by older versions are drafts, which GitHub refuses to merge; no-op when already ready.
    await runProgram("gh", ["pr", "ready", branch], { cwd: wt });
    const r = await runProgram("gh", ["pr", "merge", branch, "--squash", "--delete-branch", "--body", message], { cwd: wt });
    if (r.code !== 0) throw new Error(`gh pr merge failed: ${tail(r.stderr || r.stdout, 8)}`);
    await git(p.path, "pull", "--ff-only").catch(() => "");
    await removeWorktree(p, wt, branch, false);
    return "Squash-merged on GitHub";
  }
  if (p.source === "azure" && (await hasRemote(p.path))) {
    return "Complete the pull request in Azure DevOps (policies and approvals live there).";
  }
  const current = await git(p.path, "rev-parse", "--abbrev-ref", "HEAD");
  if (current !== p.base_branch) throw new Error(`Project folder is on ${current}; switch it to ${p.base_branch} first`);
  if ((await git(p.path, "status", "--porcelain")).trim()) throw new Error("Project folder has uncommitted changes");
  await git(p.path, "merge", "--squash", branch);
  await git(p.path, "-c", "user.name=AgentDesk", "-c", "user.email=agentdesk@localhost", "commit", "-q", "-m", message);
  await removeWorktree(p, wt, branch, true);
  return `Squash-merged into ${p.base_branch}`;
}

export async function removeWorktree(p: ProjectRow, wt: string, branch: string, deleteBranch: boolean, deleteRemote = false) {
  if (existsSync(wt)) await git(p.path, "worktree", "remove", "--force", wt).catch(() => "");
  if (deleteBranch) await git(p.path, "branch", "-D", branch).catch(() => "");
  if (deleteRemote && (await hasRemote(p.path))) {
    // Only branches this tool created (task/...) are ever deleted on the remote.
    if (branch.startsWith("task/")) await git(p.path, "push", "origin", "--delete", branch).catch(() => "");
  }
}
