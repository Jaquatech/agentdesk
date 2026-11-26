import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import type { DB } from "../src/db.ts";
import { buildReport } from "../src/dataFactory/report.ts";
import { compareReports } from "../src/dataFactory/compare.ts";
import { compareCsv, compareMarkdown } from "../src/dataFactory/compareExport.ts";

type Ctx = Awaited<ReturnType<typeof buildApp>>;
interface Setup { ctx: Ctx; headers: { cookie: string; host: string }; project: number; dataset: number }

async function setup(): Promise<Setup> {
  const data = mkdtempSync(join(tmpdir(), "ad-cmp-"));
  const repo = mkdtempSync(join(tmpdir(), "ad-cmp-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# demo\n");
  const ctx = await buildApp({ dataDir: data });
  const res = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
  const headers = { cookie: String(res.headers["set-cookie"]).split(";")[0], host: "localhost" };
  const project = (await ctx.app.inject({ method: "POST", url: "/api/projects", headers, payload: { name: "df", source: "local", path: repo, data_factory: 1 } })).json().id;
  const dataset = Number(ctx.db.prepare("INSERT INTO eval_datasets (project_id, name) VALUES (?, 'set')").run(project).lastInsertRowid);
  return { ctx, headers, project, dataset };
}

/** A dataset version with the given [key, input] cases (expected is "e-<key>"). */
function version(db: DB, dataset: number, v: number, cases: [string, string][]) {
  const id = Number(db.prepare("INSERT INTO eval_dataset_versions (dataset_id, version, format, sha256, case_count) VALUES (?, ?, 'jsonl', ?, ?)")
    .run(dataset, v, `sha${v}`, cases.length).lastInsertRowid);
  const ids = cases.map(([key, input], n) => Number(db.prepare("INSERT INTO eval_cases (version_id, case_key, input, expected, position) VALUES (?, ?, ?, ?, ?)")
    .run(id, key, input, `e-${key}`, n).lastInsertRowid));
  return { id, cases: cases.map(([key, input], n) => ({ id: ids[n], key, input })) };
}

interface RunOpts {
  status?: string; system?: string; max?: number; rubric?: string; judgeModel?: string | null;
  /** One entry per model: provider, model, and per case key an answer and a judging (true / false / null for none). */
  models: { provider: string; model: string; answers: Record<string, [string, boolean | null]> }[];
}

function run(s: Setup, ver: ReturnType<typeof version>, o: RunOpts) {
  const db = s.ctx.db;
  const runId = Number(db.prepare("INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status) VALUES (?, ?, 'r', ?, ?, ?)")
    .run(s.project, ver.id, o.system ?? "p", o.max ?? 100, o.status ?? "done").lastInsertRowid);
  const judgeModel = o.judgeModel === undefined ? "jm" : o.judgeModel;
  const judge = judgeModel === null ? null
    : Number(db.prepare("INSERT INTO eval_judge_runs (run_id, provider_name, model, rubric, status) VALUES (?, 'P', ?, ?, 'done')").run(runId, judgeModel, o.rubric ?? "guide").lastInsertRowid);
  for (const m of o.models) {
    const rm = Number(db.prepare("INSERT INTO eval_run_models (run_id, provider_name, model) VALUES (?, ?, ?)").run(runId, m.provider, m.model).lastInsertRowid);
    for (const c of ver.cases) {
      const a = m.answers[c.key];
      if (!a) continue;
      const r = Number(db.prepare("INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status, error, tokens_in, tokens_out, cost_usd, ms) VALUES (?, ?, ?, ?, ?, 'ok', '', 1, 1, 0.5, 10)")
        .run(runId, rm, c.id, c.key, a[0]).lastInsertRowid);
      if (judge !== null && a[1] !== null) {
        db.prepare("INSERT INTO eval_judgements (judge_run_id, result_id, score, pass, reason, status) VALUES (?, ?, ?, ?, 'why', 'ok')").run(judge, r, a[1] ? 5 : 2, a[1] ? 1 : 0);
      }
    }
  }
  return { id: runId, judge };
}

const CASES: [string, string][] = [["k1", "q1"], ["k2", "q2"], ["k3", "q3"], ["k4", "q4"], ["k5", "q5"]];
const one = (answers: Record<string, [string, boolean | null]>) => [{ provider: "P", model: "m", answers }];
const report = (s: Setup, r: { id: number; judge: number | null }) => buildReport(s.ctx.db, r.id, r.judge);

describe("compare reports", () => {
  it("sorts cases into fixed, broke, same and unjudged, in group order", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES);
    const a = run(s, v, { models: one({ k1: ["x", true], k2: ["x", false], k3: ["x", false], k4: ["x", true], k5: ["x", null] }) });
    const b = run(s, v, { models: one({ k1: ["y", false], k2: ["y", true], k3: ["y", false], k4: ["y", true], k5: ["y", true] }) });
    const c = compareReports(report(s, a), report(s, b));
    expect(c.pairs).toHaveLength(1);
    const p = c.pairs[0];
    expect(p.label).toBe("P / m");
    expect(p.counts).toEqual({ fixed: 1, broke: 1, same_pass: 1, same_fail: 1, unjudged: 1 });
    expect(p.cases.map((k) => [k.case_key, k.change])).toEqual([["k1", "broke"], ["k2", "fixed"], ["k3", "same_fail"], ["k5", "unjudged"], ["k4", "same_pass"]]);
    expect(p.cases[0]).toMatchObject({ input: "q1", expected: "e-k1", a: { answer: "x", pass: true, score: 5 }, b: { answer: "y", pass: false, score: 2 } });
    expect(p.shared).toBe(5);
    expect(p.a).toMatchObject({ answers: 5, judged: 4, pass_rate: 0.5, cost_usd: 2.5, avg_ms: 10 });
    expect(c.warnings).toEqual([]);
    await s.ctx.app.close();
  });

  it("leaves out cases whose input changed and counts them, and the cases on one side only", async () => {
    const s = await setup();
    const v1 = version(s.ctx.db, s.dataset, 1, [["k1", "q1"], ["k2", "q2"], ["k3", "q3"]]);
    const v2 = version(s.ctx.db, s.dataset, 2, [["k1", "q1"], ["k2", "other"], ["k4", "q4"]]);
    const a = run(s, v1, { models: one({ k1: ["x", true], k2: ["x", true], k3: ["x", true] }) });
    const b = run(s, v2, { models: one({ k1: ["x", true], k2: ["x", false], k4: ["x", true] }) });
    const c = compareReports(report(s, a), report(s, b));
    const p = c.pairs[0];
    expect(p).toMatchObject({ shared: 1, changed_input: 1, only_a_cases: 1, only_b_cases: 1 });
    expect(p.cases.map((k) => k.case_key)).toEqual(["k1"]);
    expect(p.a.answers).toBe(1);
    expect(c.warnings).toEqual(["Different dataset versions (v1 and v2)"]);
    await s.ctx.app.close();
  });

  it("pairs the only model of each run even when they differ", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES.slice(0, 1));
    const a = run(s, v, { models: [{ provider: "P", model: "old", answers: { k1: ["x", false] } }] });
    const b = run(s, v, { models: [{ provider: "Q", model: "new", answers: { k1: ["x", true] } }] });
    const c = compareReports(report(s, a), report(s, b));
    expect(c.pairs.map((p) => p.label)).toEqual(["old → new"]);
    expect(c.pairs[0].counts.fixed).toBe(1);
    expect(c.only_a).toEqual([]);
    expect(c.only_b).toEqual([]);
    await s.ctx.app.close();
  });

  it("pairs equal models and lists the unmatched one", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES.slice(0, 1));
    const a = run(s, v, { models: [{ provider: "P", model: "m", answers: { k1: ["x", true] } }, { provider: "P", model: "only-a", answers: { k1: ["x", true] } }] });
    const b = run(s, v, { models: [{ provider: "P", model: "m", answers: { k1: ["x", true] } }, { provider: "Q", model: "only-b", answers: { k1: ["x", true] } }] });
    const c = compareReports(report(s, a), report(s, b));
    expect(c.pairs.map((p) => p.label)).toEqual(["P / m"]);
    expect(c.only_a).toEqual(["P / only-a"]);
    expect(c.only_b).toEqual(["Q / only-b"]);
    await s.ctx.app.close();
  });

  it("warns, in order, about everything that makes the runs hard to compare", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES.slice(0, 1));
    const other = Number(s.ctx.db.prepare("INSERT INTO eval_datasets (project_id, name) VALUES (?, 'set2')").run(s.project).lastInsertRowid);
    const v2 = version(s.ctx.db, other, 1, CASES.slice(0, 1));
    const m = one({ k1: ["x", true] });
    const a = run(s, v, { models: m, judgeModel: null, status: "stopped" });
    const b = run(s, v2, { models: m, judgeModel: null });
    expect(compareReports(report(s, a), report(s, b)).warnings).toEqual(["Different datasets", "Run A is not judged", "Run B is not judged", "Run A did not finish: stopped"]);

    const a2 = run(s, v, { models: m });
    const b2 = run(s, v, { models: m, judgeModel: "other", rubric: "other guide", system: "q", max: 200, status: "failed" });
    expect(compareReports(report(s, a2), report(s, b2)).warnings).toEqual([
      "Different judge models", "Different scoring guides", "The system prompt differs", "The answer token limit differs", "Run B did not finish: failed",
    ]);
    const v3 = version(s.ctx.db, s.dataset, 2, CASES.slice(0, 1));
    const c3 = run(s, v3, { models: m });
    expect(compareReports(report(s, a2), report(s, c3)).warnings).toEqual(["Different dataset versions (v1 and v2)"]);
    await s.ctx.app.close();
  });

  it("answers the route errors", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES.slice(0, 1));
    const m = one({ k1: ["x", true] });
    const a = run(s, v, { models: m });
    const b = run(s, v, { models: m });
    const running = run(s, v, { models: m, status: "running" });
    const get = (q: string) => s.ctx.app.inject({ method: "GET", url: `/api/eval-compare?${q}`, headers: s.headers });
    expect((await get(`a=${a.id}&b=999`)).json()).toEqual({ error: "No such run" });
    expect((await get(`a=${a.id}&b=999`)).statusCode).toBe(404);
    const same = await get(`a=${a.id}&b=${a.id}`);
    expect([same.statusCode, same.json()]).toEqual([400, { error: "Choose two different runs" }]);
    const otherProject = Number(s.ctx.db.prepare("INSERT INTO projects (name, source, path, data_factory) VALUES ('p2', 'local', '/tmp/x', 1)").run().lastInsertRowid);
    const od = Number(s.ctx.db.prepare("INSERT INTO eval_datasets (project_id, name) VALUES (?, 'o')").run(otherProject).lastInsertRowid);
    const ov = version(s.ctx.db, od, 1, CASES.slice(0, 1));
    const foreign = Number(s.ctx.db.prepare("INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status) VALUES (?, ?, 'f', 'p', 1, 'done')").run(otherProject, ov.id).lastInsertRowid);
    const mixed = await get(`a=${a.id}&b=${foreign}`);
    expect([mixed.statusCode, mixed.json()]).toEqual([400, { error: "Choose two runs of the same project" }]);
    const early = await get(`a=${a.id}&b=${running.id}`);
    expect([early.statusCode, early.json()]).toEqual([409, { error: "This run has not finished yet" }]);
    const badJudge = await get(`a=${a.id}&b=${b.id}&judge_a=${b.judge}`);
    expect([badJudge.statusCode, badJudge.json()]).toEqual([404, { error: "No such judge run" }]);
    const ok = await get(`a=${a.id}&b=${b.id}&judge_a=${a.judge}&judge_b=${b.judge}`);
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.compare.pairs).toHaveLength(1);
    expect(body.markdown).toContain("# Compare:");
    expect(body.judge_runs_a).toHaveLength(1);
    await s.ctx.app.close();
  });

  it("guards a CSV answer that starts with =, and the markdown fences answers", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES.slice(0, 1));
    const a = run(s, v, { models: one({ k1: ["=1+1", true] }) });
    const b = run(s, v, { models: one({ k1: ["```\nx", false] }) });
    const c = compareReports(report(s, a), report(s, b));
    const csv = compareCsv(c);
    expect(csv.split("\r\n")[0]).toContain("model_pair,case_key,change,input,expected,status_a,answer_a");
    expect(csv).toContain("'=1+1");
    const md = compareMarkdown(c);
    expect(md).toContain("## Broke");
    expect(md).toContain("````");
    const r = await s.ctx.app.inject({ method: "GET", url: `/api/eval-compare.csv?a=${a.id}&b=${b.id}`, headers: s.headers });
    expect(r.headers["content-disposition"]).toContain(`compare-${a.id}-${b.id}.csv`);
    await s.ctx.app.close();
  });

  it("serves Markdown, JSON and an Excel file that starts with PK", async () => {
    const s = await setup();
    const v = version(s.ctx.db, s.dataset, 1, CASES.slice(0, 1));
    const a = run(s, v, { models: one({ k1: ["x", true] }) });
    const b = run(s, v, { models: one({ k1: ["x", true] }) });
    const get = (ext: string) => s.ctx.app.inject({ method: "GET", url: `/api/eval-compare.${ext}?a=${a.id}&b=${b.id}`, headers: s.headers });
    const x = await get("xlsx");
    expect(x.statusCode).toBe(200);
    expect(x.headers["content-disposition"]).toContain(`compare-${a.id}-${b.id}.xlsx`);
    expect(x.rawPayload.subarray(0, 2).toString()).toBe("PK");
    expect((await get("md")).body).toContain("## Warnings");
    expect((await get("json")).json().schema_version).toBe(1);
    await s.ctx.app.close();
  });
});
