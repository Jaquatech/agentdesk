import { describe, it, expect } from "vitest";
import { commandProblem, envFileCandidates, setupProblem, suggestSetup, suggestVerify, verifyWarnings, type Folder } from "../src/verifyHelp.ts";

const folder = (files: Record<string, string>): Folder => ({
  has: (n) => n in files,
  read: (n) => files[n],
  names: () => Object.keys(files),
});
const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

describe("verify suggestions", () => {
  it("offers only the scripts a package.json has, and skips the npm init test placeholder", () => {
    const f = folder({ "package.json": pkg({ lint: "eslint .", test: 'echo "Error: no test specified" && exit 1', build: "vite build" }) });
    expect(suggestVerify(f).map((s) => s.command)).toEqual(["npm run lint", "npm run build", "git diff --check"]);
    const g = folder({ "package.json": pkg({ test: "vitest run" }), "pnpm-lock.yaml": "" });
    expect(suggestVerify(g).map((s) => s.command)).toEqual(["pnpm test", "git diff --check"]);
  });

  it("recognises other project types", () => {
    expect(suggestVerify(folder({ "go.mod": "" })).map((s) => s.command)).toEqual(["go vet ./...", "go test ./...", "git diff --check"]);
    expect(suggestVerify(folder({ "Cargo.toml": "" })).map((s) => s.command)).toContain("cargo test");
    expect(suggestVerify(folder({ "App.sln": "" })).map((s) => s.command)).toContain("dotnet test");
    expect(suggestVerify(folder({ "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]" })).map((s) => s.command)).toEqual(["pytest", "ruff check .", "git diff --check"]);
  });

  it("offers only the light check for a plain HTML project", () => {
    expect(suggestVerify(folder({ "index.html": "", "team.html": "" }))).toEqual([expect.objectContaining({ command: "git diff --check" })]);
  });
});

describe("verify warnings", () => {
  it("warns about npm commands that cannot work in a folder without package.json", () => {
    const w = verifyWarnings(folder({ "team.html": "" }), ["npm run lint", "npm test", "git diff --check"]);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain("no package.json");
  });

  it("warns about a missing script or the placeholder test, but not about install commands or chains that are fine", () => {
    const f = folder({ "package.json": pkg({ lint: "eslint .", test: 'echo "Error: no test specified" && exit 1' }) });
    const w = verifyWarnings(f, ["npm run lint", "npm run typecheck", "npm test", "npm ci", "npm run lint && npm run build"]);
    expect(w).toEqual([
      '"npm run typecheck" will fail: package.json has no "typecheck" script.',
      '"npm test" will fail: the "test" script in package.json is only the placeholder npm init writes.',
      '"npm run build" will fail: package.json has no "build" script.',
    ]);
  });
});

describe("command problems", () => {
  it("explains a command that cannot run, and says nothing about one that ran and failed", () => {
    expect(commandProblem('exit 1\n\nnpm error Missing script: "lint"\nnpm error')).toBe('package.json has no "lint" script.');
    expect(commandProblem("exit 1\nnpm error code ENOENT\nnpm error path C:\\x\\package.json")).toContain("no package.json");
    expect(commandProblem("exit 127\nbash: ruff: command not found")).toContain("not found");
    expect(commandProblem("exit 1\nThe term 'cargo' is not recognized as the name of a cmdlet")).toContain("not found");
    expect(commandProblem("exit 1\n1) Team page > shows six cards\nAssertionError")).toBeUndefined();
  });
});

describe("setup suggestions and the missing install warning", () => {
  const deps = (scripts: Record<string, string>) => JSON.stringify({ scripts, devDependencies: { vitest: "^1" } });

  it("offers the install command that matches the lockfile", () => {
    expect(suggestSetup(folder({ "package.json": deps({}), "package-lock.json": "" })).map((s) => s.command)).toEqual(["npm ci --no-audit --no-fund"]);
    expect(suggestSetup(folder({ "package.json": deps({}), "pnpm-lock.yaml": "" })).map((s) => s.command)).toEqual(["pnpm install --frozen-lockfile"]);
    expect(suggestSetup(folder({ "package.json": deps({}), "yarn.lock": "" })).map((s) => s.command)).toEqual(["yarn install --frozen-lockfile"]);
    expect(suggestSetup(folder({ "package.json": deps({}) })).map((s) => s.command)).toEqual(["npm install --no-audit --no-fund"]);
    expect(suggestSetup(folder({ "requirements.txt": "" })).map((s) => s.command)).toEqual(["pip install -r requirements.txt"]);
    expect(suggestSetup(folder({ "go.mod": "", "index.html": "" }))).toEqual([]);
  });

  it("warns when scripts are verified but nothing installs the packages", () => {
    const f = folder({ "package.json": deps({ test: "vitest run" }) });
    const w = verifyWarnings(f, ["npm test"], []);
    expect(w).toEqual(['"npm test" will fail in a fresh worktree: nothing installs the packages. Add an install command under Setup.']);
    expect(verifyWarnings(f, ["npm test"], ["npm ci --no-audit --no-fund"])).toEqual([]);
    expect(verifyWarnings(f, ["npm ci", "npm test"], [])).toEqual([]); // an install in the verify box counts too
    // no dependencies, nothing to install
    expect(verifyWarnings(folder({ "package.json": pkg({ test: "node test.js" }) }), ["npm test"], [])).toEqual([]);
  });
});

describe("env files and setup problems", () => {
  it("offers the test env file before the real one, only when they exist", () => {
    expect(envFileCandidates(folder({ ".env": "", ".env.test": "" }))).toEqual([".env.test", ".env"]);
    expect(envFileCandidates(folder({ "index.html": "" }))).toEqual([]);
  });
  it("recognises failures that no code change can fix", () => {
    expect(setupProblem("Error: Missing environment variable: SESSION_SECRET")).toContain("SESSION_SECRET");
    expect(setupProblem("environment variable ATTACHMENTS_ROOT is not set")).toContain("ATTACHMENTS_ROOT");
    expect(setupProblem('npm error Missing script: "lint"')).toContain("lint");
    expect(setupProblem("1) shows six cards\nAssertionError")).toBeUndefined();
  });
});
