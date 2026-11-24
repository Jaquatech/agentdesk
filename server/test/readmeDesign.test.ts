import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("design choices documentation", () => {
  it("README has a short Design choices section", () => {
    const lines = read("../../README.md").split(/\r?\n/);
    const start = lines.indexOf("## Design choices");
    expect(start).toBeGreaterThanOrEqual(0);
    let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
    if (end === -1) end = lines.length;
    expect(end - start - 1).toBeLessThan(80);
  });

  it("CLAUDE.md and the standards name the token efficiency rule", () => {
    expect(read("../../CLAUDE.md")).toContain("Token efficiency");
    expect(read("../../docs/standards.md")).toContain("Token efficiency");
  });
});
