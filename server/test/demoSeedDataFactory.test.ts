import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";
import { seedDemo } from "../src/demoSeed.ts";

describe("demo seed: Data factory", () => {
  it("turns the Data factory on and imports one sample dataset, once", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ad-seed-df-"));
    const ctx = await buildApp({ dataDir });
    expect(seedDemo(ctx.db, dataDir)).toBe(true);
    expect(ctx.db.prepare("SELECT data_factory FROM projects").get()).toEqual({ data_factory: 1 });
    const dataset = ctx.db.prepare("SELECT id FROM eval_datasets WHERE name = 'support-questions'").get() as { id: number };
    const versions = ctx.db.prepare("SELECT version, case_count FROM eval_dataset_versions WHERE dataset_id = ?").all(dataset.id);
    expect(versions).toEqual([{ version: 1, case_count: 8 }]);
    expect(ctx.db.prepare("SELECT model, for_test, for_judge FROM eval_models").all()).toEqual([{ model: "demo-model", for_test: 1, for_judge: 1 }]);
    expect(seedDemo(ctx.db, dataDir)).toBe(false);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE dataset_id = ?").get(dataset.id)).toEqual({ n: 1 });
    await ctx.app.close();
  });
});
