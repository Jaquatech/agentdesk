import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";
import { seedDemo } from "../src/demoSeed.ts";

describe("demo seed", () => {
  it("fills an empty database with a team and a Scrum project, once", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ad-seed-"));
    const ctx = await buildApp({ dataDir });
    expect(seedDemo(ctx.db, dataDir)).toBe(true);
    const count = (table: string) => (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("agents")).toBe(4);
    expect(count("team_members")).toBe(4);
    expect(ctx.db.prepare("SELECT process, team_id FROM projects").get()).toMatchObject({ process: "scrum" });
    expect(count("backlog_items")).toBe(6);
    expect(count("sprints")).toBe(2);
    expect(count("tasks")).toBe(5);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE section IN ('releases', 'tasks') AND project_id IS NOT NULL").get()).toMatchObject({ n: 6 });
    expect(seedDemo(ctx.db, dataDir)).toBe(false);
    expect(count("agents")).toBe(4);
    await ctx.app.close();
  });
});
