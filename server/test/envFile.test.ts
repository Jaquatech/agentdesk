import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placeEnvFile, validEnvFileName } from "../src/orchestrator/envFile.ts";

const dirs = () => ({ project: mkdtempSync(join(tmpdir(), "ad-proj-")), wt: mkdtempSync(join(tmpdir(), "ad-wt-")) });

describe("env file for checks", () => {
  it("accepts file names inside the project and nothing else", () => {
    for (const ok of ["", ".env.test", "config/.env"]) expect(validEnvFileName(ok)).toBe(true);
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:\\x\\.env", "*.env"]) expect(validEnvFileName(bad)).toBe(false);
  });
  it("copies the file under the target name and removes it again", () => {
    const { project, wt } = dirs();
    writeFileSync(join(project, ".env.demo"), "A=1");
    const h = placeEnvFile(project, wt, ".env.demo");
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("A=1");
    expect(existsSync(join(wt, ".env.demo"))).toBe(false);
    h.cleanup();
    expect(existsSync(join(wt, ".env"))).toBe(false);
  });
  it("puts a file the repository already has back as it was", () => {
    const { project, wt } = dirs();
    writeFileSync(join(project, ".env.demo"), "real");
    writeFileSync(join(wt, ".env"), "");
    placeEnvFile(project, wt, ".env.demo").cleanup();
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("");
  });
  it("explains a missing file", () => {
    const { project, wt } = dirs();
    mkdirSync(join(project, "x"));
    expect(() => placeEnvFile(project, wt, ".env.test")).toThrow(/was not found in the project folder/);
  });
});
