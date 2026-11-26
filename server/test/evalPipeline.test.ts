import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { datasetDir } from "../src/dataFactory/datasets.ts";

const GATE = "Approve this dataset version on the Datasets tab before running it.";

type Version = { id: number; version: number; approved_at: string | null; cleaned_counts: string };
/** The parts of the JSON answers these tests read. */
type Res = {
  error: string; id: number; dataset_id: number; version: Version; versions: Version[];
  original_deleted: boolean; kept_reason: string | null; changed_cases: number; counts: Record<string, number>;
  preview: { case_key: string; before: { input: string }; after: { input: string } }[];
};

describe("dataset approval", () => {
  let data: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<{ code: number; body: Res }>;
  let projectId: number, offId: number, modelId: number;

  const dirty = [
    JSON.stringify({ input: "Mail anna@example.com or call +358 40 555 0123", expected: "ok", tags: ["a"] }),
    JSON.stringify({ input: "Marta Lindqvist asked, id 010190-900P", expected: "fine" }),
    JSON.stringify({ input: "plain question", expected: "plain answer" }),
  ].join("\n");
  const clean = [JSON.stringify({ input: "one", expected: "1" }), JSON.stringify({ input: "two", expected: "2" })].join("\n");

  const upload = async (name: string, text: string) => {
    const r = await call("POST", `/api/projects/${projectId}/datasets`, { name, format: "jsonl", text });
    return { datasetId: r.body.dataset_id as number, versionId: r.body.version.id as number };
  };
  const count = (sql: string, ...a: number[]) => (ctx.db.prepare(sql).get(...a) as { n: number }).n;
  const insertRun = (versionId: number, status = "planned") =>
    Number(ctx.db.prepare("INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status, cap_usd) VALUES (?, ?, 'r', '', 100, ?, 1)").run(projectId, versionId, status).lastInsertRowid);

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-pl-"));
    const repo = mkdtempSync(join(tmpdir(), "ad-pl-repo-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "# demo\n");
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => {
      const r = await ctx.app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
      return { code: r.statusCode, body: r.json() };
    };
    projectId = (await call("POST", "/api/projects", { name: "df", source: "local", path: repo, data_factory: 1 })).body.id as number;
    offId = (await call("POST", "/api/projects", { name: "off", source: "local", path: repo })).body.id as number;
    const prov = Number(ctx.db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES ('O', 'ollama', '', 'm')").run().lastInsertRowid);
    modelId = (await call("POST", `/api/projects/${projectId}/models`, { provider_id: prov, model: "local-llm" })).body.id as number;
  });

  it("keeps own names and terms within the limits", async () => {
    const url = `/api/projects/${projectId}/sensitive-terms`;
    expect((await call("GET", url)).body).toEqual({ people: [], terms: [] });
    const put = await call("PUT", url, { people: ["  Marta Lindqvist ", "", "Marta Lindqvist", "Bo"], terms: ["Project X"] });
    expect(put.code).toBe(200);
    expect((await call("GET", url)).body).toEqual({ people: ["Marta Lindqvist", "Bo"], terms: ["Project X"] });
    const many = Array.from({ length: 501 }, (_, i) => `name${i}`);
    expect((await call("PUT", url, { people: many, terms: [] })).code).toBe(400);
    expect((await call("PUT", url, { people: [], terms: ["x".repeat(201)] })).code).toBe(400);
    expect((await call("PUT", url, { people: "no", terms: [] })).code).toBe(400);
    expect((await call("PUT", url, { people: Array.from({ length: 500 }, (_, i) => `n${i}`), terms: ["y".repeat(200)] })).code).toBe(200);
  });

  it("checks without changing anything, and finds a name only once it is in the list", async () => {
    const { versionId } = await upload("set", dirty);
    const before = count("SELECT COUNT(*) AS n FROM eval_dataset_versions") + count("SELECT COUNT(*) AS n FROM eval_cases");
    const r = await call("POST", `/api/dataset-versions/${versionId}/check`, {});
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ total_cases: 3, changed_cases: 2, finding_count: 3 });
    expect(r.body.counts).toEqual({ email: 1, phone: 1, personal_id: 1 });
    expect(r.body.preview.map((p: { case_key: string }) => p.case_key)).toHaveLength(2);
    expect(r.body.preview[0].before.input).toContain("anna@example.com");
    expect(r.body.preview[0].after.input).toBe("Mail Email_1 or call Phone_1");
    expect((await call("POST", `/api/dataset-versions/${versionId}/check`, { offset: 1 })).body.preview).toHaveLength(1);
    expect((await call("POST", `/api/dataset-versions/${versionId}/check`, { disabled_kinds: ["email", "phone", "personal_id"] })).body.changed_cases).toBe(0);
    expect((await call("POST", `/api/dataset-versions/${versionId}/check`, { disabled_kinds: ["nope"] })).code).toBe(400);

    await call("PUT", `/api/projects/${projectId}/sensitive-terms`, { people: ["Marta Lindqvist"], terms: [] });
    const again = await call("POST", `/api/dataset-versions/${versionId}/check`, {});
    expect(again.body.counts).toMatchObject({ person: 1 });
    expect(count("SELECT COUNT(*) AS n FROM eval_dataset_versions") + count("SELECT COUNT(*) AS n FROM eval_cases")).toBe(before);
    expect(ctx.db.prepare("SELECT approved_at FROM eval_dataset_versions WHERE id = ?").get(versionId)).toEqual({ approved_at: null });
  });

  it("approves a version with nothing to replace in place", async () => {
    const { datasetId, versionId } = await upload("set", clean);
    const r = await call("POST", `/api/dataset-versions/${versionId}/approve`, {});
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ original_deleted: false, kept_reason: null });
    expect(r.body.version.id).toBe(versionId);
    expect(r.body.version.approved_at).toBeTruthy();
    expect(count("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE dataset_id = ?", datasetId)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?", versionId)).toBe(2);
    expect((await call("POST", `/api/dataset-versions/${versionId}/approve`, {})).code).toBe(409);
  });

  it("creates the cleaned version and removes the original rows and file", async () => {
    await call("PUT", `/api/projects/${projectId}/sensitive-terms`, { people: ["Marta Lindqvist"], terms: [] });
    const { datasetId, versionId } = await upload("set", dirty);
    const dir = datasetDir(data, datasetId);
    expect(existsSync(join(dir, "v1.jsonl"))).toBe(true);

    const r = await call("POST", `/api/dataset-versions/${versionId}/approve`, {});
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ original_deleted: true, kept_reason: null });
    expect(r.body.version).toMatchObject({ version: 2, format: "jsonl", cleaned_from: 1, note: "Anonymized from v1", source_name: "", case_count: 3 });
    expect(r.body.version.approved_at).toBeTruthy();
    expect(JSON.parse(r.body.version.cleaned_counts)).toEqual({ person: 1, email: 1, phone: 1, personal_id: 1 });

    expect(count("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE id = ?", versionId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?", versionId)).toBe(0);
    expect(existsSync(join(dir, "v1.jsonl"))).toBe(false);
    const stored = readFileSync(join(dir, "v2.jsonl"), "utf8");
    for (const value of ["anna@example.com", "555 0123", "Marta", "010190-900P"]) {
      expect(stored).not.toContain(value);
      const n = (ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_cases WHERE input LIKE ? OR COALESCE(expected, '') LIKE ? OR meta LIKE ? OR tags LIKE ? OR case_key LIKE ?")
        .get(...Array(5).fill(`%${value}%`)) as { n: number }).n;
      expect(n).toBe(0);
    }
    const cases = (await call("GET", `/api/dataset-versions/${r.body.version.id}/cases`)).body as unknown as { input: string; tags: string[] }[];
    expect(cases[0]).toMatchObject({ input: "Mail Email_1 or call Phone_1", tags: ["a"] });
    expect(cases[2].input).toBe("plain question");
    // The approved copy can be used by a run.
    const plan = await call("POST", `/api/projects/${projectId}/runs`, { version_id: r.body.version.id, model_ids: [modelId], max_tokens: 100 });
    expect(plan.code).toBe(200);
  });

  it("keeps the original with delete_original false", async () => {
    const { datasetId, versionId } = await upload("set", dirty);
    const r = await call("POST", `/api/dataset-versions/${versionId}/approve`, { delete_original: false });
    expect(r.body).toMatchObject({ original_deleted: false });
    expect(count("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?", versionId)).toBe(3);
    expect(existsSync(join(datasetDir(data, datasetId), "v1.jsonl"))).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE dataset_id = ?", datasetId)).toBe(2);
    const original = await call("GET", `/api/datasets/${datasetId}`);
    expect(original.body.versions.find((v) => v.id === versionId)?.approved_at).toBeNull();
  });

  it("keeps the original and says why when a run uses it", async () => {
    const { versionId } = await upload("set", dirty);
    insertRun(versionId, "done");
    const r = await call("POST", `/api/dataset-versions/${versionId}/approve`, {});
    expect(r.code).toBe(200);
    expect(r.body.original_deleted).toBe(false);
    expect(r.body.kept_reason).toContain("1 runs use it");
    expect(count("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?", versionId)).toBe(3);
  });

  it("refuses to plan, estimate and start with an unapproved version", async () => {
    const { versionId } = await upload("set", clean);
    const body = { version_id: versionId, model_ids: [modelId], max_tokens: 100, cap_usd: 1 };
    for (const url of [`/api/projects/${projectId}/runs/estimate`, `/api/projects/${projectId}/runs`]) {
      const r = await call("POST", url, body);
      expect(r.code).toBe(400);
      expect(r.body.error).toBe(GATE);
    }
    const runId = insertRun(versionId);
    const start = await call("POST", `/api/eval-runs/${runId}/start`, {});
    expect(start.code).toBe(409);
    expect(start.body.error).toBe(GATE);
    expect(count("SELECT COUNT(*) AS n FROM eval_runs WHERE status = 'running'")).toBe(0);
    await call("POST", `/api/dataset-versions/${versionId}/approve`, {});
    expect((await call("POST", `/api/projects/${projectId}/runs/estimate`, body)).code).toBe(200);
  });

  it("lists the approval of the latest version", async () => {
    const { versionId } = await upload("set", clean);
    expect((await call("GET", `/api/projects/${projectId}/datasets`)).body).toMatchObject([{ approved_at: null }]);
    await call("POST", `/api/dataset-versions/${versionId}/approve`, {});
    const list = (await call("GET", `/api/projects/${projectId}/datasets`)).body as unknown as { approved_at: string | null }[];
    expect(list[0].approved_at).toBeTruthy();
  });

  it("deletes one version, but not the only one or one a run uses", async () => {
    const { datasetId, versionId } = await upload("set", dirty);
    expect((await call("DELETE", `/api/dataset-versions/${versionId}`)).code).toBe(409);
    await call("POST", `/api/dataset-versions/${versionId}/approve`, { delete_original: false });
    const second = Number((ctx.db.prepare("SELECT id FROM eval_dataset_versions WHERE dataset_id = ? AND version = 2").get(datasetId) as { id: number }).id);

    insertRun(versionId, "done");
    const used = await call("DELETE", `/api/dataset-versions/${versionId}`);
    expect(used.code).toBe(409);
    expect(used.body.error).toContain("used by 1 runs");

    const ok = await call("DELETE", `/api/dataset-versions/${second}`);
    expect(ok.code).toBe(200);
    expect(count("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE id = ?", second)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM eval_cases WHERE version_id = ?", second)).toBe(0);
    expect(existsSync(join(datasetDir(data, datasetId), "v2.jsonl"))).toBe(false);
  });

  it("refuses every route when the Data factory is off, and answers 404 for an unknown id", async () => {
    const { versionId } = await upload("set", clean);
    ctx.db.prepare("UPDATE projects SET data_factory = 0 WHERE id = ?").run(projectId);
    for (const [m, u] of [
      ["GET", `/api/projects/${projectId}/sensitive-terms`],
      ["PUT", `/api/projects/${projectId}/sensitive-terms`],
      ["POST", `/api/dataset-versions/${versionId}/check`],
      ["POST", `/api/dataset-versions/${versionId}/approve`],
      ["DELETE", `/api/dataset-versions/${versionId}`],
    ]) {
      expect((await call(m, u, { people: [], terms: [] })).code, `${m} ${u}`).toBe(409);
    }
    expect((await call("GET", `/api/projects/${offId}/sensitive-terms`)).code).toBe(409);
    for (const [m, u] of [["POST", "/api/dataset-versions/9999/check"], ["POST", "/api/dataset-versions/9999/approve"], ["DELETE", "/api/dataset-versions/9999"], ["GET", "/api/projects/9999/sensitive-terms"]]) {
      expect((await call(m, u, {})).code, `${m} ${u}`).toBe(404);
    }
  });
});
