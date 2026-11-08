import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Help with a project's verify commands: which ones are likely to work in this folder, a warning for a command that
 * cannot work here, and a plain explanation when a check failed because the command itself is broken.
 * Suggestions are only offered to the user (one click to add); nothing is ever applied by itself, because verify
 * commands run without asking.
 */
export type Suggestion = { command: string; label: string };

/** The few things looked at in the project folder, so the rules can be tested without a disk. */
export interface Folder {
  has(name: string): boolean;
  read(name: string): string | undefined;
  names(): string[];
}

export function folderOnDisk(dir: string): Folder | null {
  try { if (!statSync(dir).isDirectory()) return null; } catch { return null; }
  return {
    has: (n) => existsSync(join(dir, n)),
    read: (n) => { try { const p = join(dir, n); return statSync(p).size < 1_000_000 ? readFileSync(p, "utf8") : undefined; } catch { return undefined; } },
    names: () => { try { return readdirSync(dir); } catch { return []; } },
  };
}

type Pkg = { scripts?: Record<string, string> };
const packageJson = (f: Folder): Pkg | null => {
  const text = f.read("package.json");
  if (text === undefined) return null;
  try { return JSON.parse(text) as Pkg; } catch { return {}; }
};
/** `npm init` writes this placeholder as the test script; running it always fails. */
const isPlaceholderTest = (cmd: string | undefined) => !cmd || /no test specified/i.test(cmd);

function runner(f: Folder) {
  if (f.has("pnpm-lock.yaml")) return { run: "pnpm run", test: "pnpm test" };
  if (f.has("yarn.lock")) return { run: "yarn", test: "yarn test" };
  return { run: "npm run", test: "npm test" };
}

export function suggestVerify(f: Folder): Suggestion[] {
  const out: Suggestion[] = [];
  const pkg = packageJson(f);
  if (pkg) {
    const r = runner(f);
    const s = pkg.scripts ?? {};
    for (const name of ["lint", "typecheck", "check"]) if (s[name]) out.push({ command: `${r.run} ${name}`, label: `package.json script "${name}"` });
    if (!isPlaceholderTest(s.test)) out.push({ command: r.test, label: 'package.json script "test"' });
    if (s.build) out.push({ command: `${r.run} build`, label: 'package.json script "build"' });
  }
  const text = (n: string) => f.read(n) ?? "";
  const names = f.names();
  if (f.has("pytest.ini") || /\[tool\.pytest|pytest/.test(text("pyproject.toml") + text("tox.ini") + text("setup.cfg")) || names.includes("tests") && (f.has("pyproject.toml") || f.has("requirements.txt"))) {
    out.push({ command: "pytest", label: "Python tests" });
  }
  if (f.has("ruff.toml") || /\[tool\.ruff/.test(text("pyproject.toml"))) out.push({ command: "ruff check .", label: "Python lint (ruff)" });
  if (f.has("go.mod")) out.push({ command: "go vet ./...", label: "Go checks" }, { command: "go test ./...", label: "Go tests" });
  if (f.has("Cargo.toml")) out.push({ command: "cargo check", label: "Rust build check" }, { command: "cargo test", label: "Rust tests" });
  if (names.some((n) => /\.(sln|csproj)$/i.test(n))) out.push({ command: "dotnet build", label: ".NET build" }, { command: "dotnet test", label: ".NET tests" });
  if (f.has("pom.xml")) out.push({ command: "mvn -q test", label: "Maven tests" });
  if (f.has("build.gradle") || f.has("build.gradle.kts")) out.push({ command: "gradle test", label: "Gradle tests" });
  // Works in any git repository, with no tools installed: conflict markers and bad whitespace in the changes.
  out.push({ command: "git diff --check", label: "Light check for any repository (conflict markers, whitespace)" });
  return out;
}

/** One warning per verify line that cannot work in this folder. */
export function verifyWarnings(f: Folder, lines: string[]): string[] {
  const pkg = packageJson(f);
  const warnings: string[] = [];
  for (const line of lines) {
    // A chain only passes when every part does: look at each part.
    for (const part of line.split(/&&|;/).map((p) => p.trim()).filter(Boolean)) {
      const m = /^(?:npm|pnpm)\s+(?:run(?:-script)?\s+)?([\w:.-]+)|^yarn\s+(?:run\s+)?([\w:.-]+)/.exec(part);
      if (!m) continue;
      const script = m[1] ?? m[2];
      if (/^(ci|install|i|add|exec|dlx|x)$/.test(script)) continue; // not a script name
      const isTest = script === "test" || script === "t" || script === "tst";
      if (!pkg) { warnings.push(`"${part}" will fail: there is no package.json in this folder.`); continue; }
      const scripts = pkg.scripts ?? {};
      const name = isTest ? "test" : script;
      if (!scripts[name]) warnings.push(`"${part}" will fail: package.json has no "${name}" script.`);
      else if (isTest && isPlaceholderTest(scripts.test)) warnings.push(`"${part}" will fail: the "test" script in package.json is only the placeholder npm init writes.`);
    }
  }
  return warnings;
}

/**
 * Why a failed check could not run at all (as opposed to running and finding a problem), from its output.
 * Returns undefined when the command ran and simply failed.
 */
export function commandProblem(output: string): string | undefined {
  const script = /Missing script:?\s*"([^"]+)"/i.exec(output);
  if (script) return `package.json has no "${script[1]}" script.`;
  if (/ENOENT[\s\S]{0,120}package\.json|Could not read package\.json|no package\.json/i.test(output)) return "there is no package.json in the project.";
  if (/command not found|is not recognized as (an internal|the name of)|CommandNotFoundException|not found in PATH|No such file or directory[^\n]*(sh|bash)\b/i.test(output)) {
    return "the command was not found on this computer.";
  }
  return undefined;
}
