import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";
import { seedDemo } from "../src/demoSeed.ts";
import { buildReport } from "../src/dataFactory/report.ts";
import { compareReports } from "../src/dataFactory/compare.ts";

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
    const run = ctx.db.prepare("SELECT id, status, version_id, cost_usd FROM eval_runs WHERE name = 'Demo run'").get() as { id: number; status: string; version_id: number; cost_usd: number };
    expect(run).toMatchObject({ status: "done", cost_usd: 0 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?").get(run.version_id)).toEqual({ n: 8 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_results WHERE run_id = ? AND status = 'ok'").get(run.id)).toEqual({ n: 8 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE kind = 'eval'").get()).toEqual({ n: 0 });
    const judge = ctx.db.prepare("SELECT id, status, cost_usd, model FROM eval_judge_runs WHERE run_id = ?").get(run.id) as { id: number; status: string; cost_usd: number; model: string };
    expect(judge).toMatchObject({ status: "done", cost_usd: 0, model: "demo-model" });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ? AND status = 'ok'").get(judge.id)).toEqual({ n: 8 });
    const passed = ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_judgements WHERE judge_run_id = ? AND pass = 1").get(judge.id) as { n: number };
    expect(passed.n).toBeGreaterThan(0);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE kind = 'judge'").get()).toEqual({ n: 0 });
    const votes = ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_votes").get() as { n: number };
    expect(votes.n).toBeGreaterThanOrEqual(3);
    expect(votes.n).toBeLessThan(8);
    const disagree = ctx.db.prepare(`SELECT COUNT(*) AS n FROM eval_votes v JOIN eval_judgements g ON g.result_id = v.result_id
      WHERE (v.verdict = 'good') <> (g.pass = 1)`).get() as { n: number };
    expect(disagree.n).toBeGreaterThan(0);
    const second = ctx.db.prepare("SELECT id, status, version_id, system_prompt FROM eval_runs WHERE name = 'Demo run, shorter prompt'").get() as
      { id: number; status: string; version_id: number; system_prompt: string };
    expect(second).toMatchObject({ status: "done", version_id: run.version_id, system_prompt: "Answer in one sentence." });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_votes v JOIN eval_results r ON r.id = v.result_id WHERE r.run_id = ?").get(second.id)).toEqual({ n: 0 });
    const secondJudge = ctx.db.prepare("SELECT id FROM eval_judge_runs WHERE run_id = ?").get(second.id) as { id: number };
    const cmp = compareReports(buildReport(ctx.db, run.id, judge.id), buildReport(ctx.db, second.id, secondJudge.id));
    expect(cmp.pairs).toHaveLength(1);
    expect(cmp.pairs[0].counts.broke).toBeGreaterThanOrEqual(1);
    expect(cmp.pairs[0].counts.fixed).toBeGreaterThanOrEqual(1);
    expect(seedDemo(ctx.db, dataDir)).toBe(false);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE dataset_id = ?").get(dataset.id)).toEqual({ n: 1 });
    await ctx.app.close();
  });
});
