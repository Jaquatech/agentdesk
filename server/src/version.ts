import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AppVersion = { version: string; commit: string; notes: string };

/** The version in the root package.json and, when run from a git checkout, the short commit, so a build can be told apart. */
export function appVersion(): AppVersion {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let version = "";
  try { version = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? ""); } catch { /* unknown */ }
  let commit = "";
  try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not a git checkout */ }
  let notes = "";
  try { notes = readFileSync(join(root, "CHANGELOG.md"), "utf8").slice(0, 100_000); } catch { /* no release notes */ }
  return { version, commit, notes };
}
