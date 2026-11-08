import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";

/**
 * "Env file for checks": a file such as .env.test from the project folder, copied into the task's worktree only while
 * the verify commands run and removed right after. Checks run when no agent is working, so the agent never sees it
 * (with a hosted model, whatever an agent can read in the worktree is sent to the provider).
 */

/** A relative path inside the project folder: no drive letters, no absolute paths, no `..`. Empty means "not used". */
export function validEnvFileName(name: string): boolean {
  if (!name) return true;
  if (name.length > 200 || isAbsolute(name) || /^[a-zA-Z]:/.test(name) || /[\0*?<>|]/.test(name)) return false;
  return !normalize(name).split(/[\\/]/).includes("..");
}

export type EnvFileHandle = { note: string; cleanup: () => void };

/**
 * Copies `name` from the project folder into the worktree. Returns a cleanup that removes only what it created,
 * so a tracked file with the same name in the worktree is never overwritten or deleted.
 * Throws a message meant for the user when the file is not there.
 */
export function placeEnvFile(projectDir: string, worktree: string, name: string): EnvFileHandle {
  if (!name) return { note: "", cleanup: () => {} };
  if (!validEnvFileName(name)) throw new Error(`Env file for checks "${name}" is not a file name inside the project folder.`);
  const from = join(projectDir, name);
  const to = join(worktree, name);
  if (!existsSync(from) || !statSync(from).isFile()) {
    throw new Error(`Env file for checks "${name}" was not found in the project folder (${projectDir}). Create it there or clear the setting.`);
  }
  if (existsSync(to)) return { note: `${name} is already part of the repository: not copied`, cleanup: () => {} };
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return { note: `copied ${name} for the checks`, cleanup: () => { try { rmSync(to, { force: true }); } catch { /* best effort */ } } };
}
