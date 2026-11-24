import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";

describe("datasets", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let status: (method: string, url: string, payload?: unknown) => Promise<number>;
  let projectId: number;

  const jsonl = (n: number, extra = "") =>
    Array.from({ length: n }, (_, i) => JSON.stringify({ input: `q${i}${extra}`, expected: `a${i}` })).join("\n");

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-ds-"));
    repo = mkdtempSync(join(tmpdir(), "ad-ds-repo-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "# demo\n");
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const send = (method: string, url: string, payload?: unknown) =>
      ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } });
    call = async (m, u, p) => (await send(m, u, p)).json();
    status = async (m, u, p) => (await send(m, u, p)).statusCode;
    projectId = (await call("POST", "/api/projects", { name: "df", source: "local", path: repo, data_factory: 1 })).id;
  });

  afterEach(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("creates v1, then reports unchanged for the same text", async () => {
    const first = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(6) });
    expect(first.version.version).toBe(1);
    expect(first.version.case_count).toBe(6);
    expect(first.unchanged).toBe(false);
    expect(existsSync(join(data, "evals", "datasets", String(first.dataset_id), "v1.jsonl"))).toBe(true);
    const again = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(6) });
    expect(again.unchanged).toBe(true);
    expect(again.version.id).toBe(first.version.id);
    const list = await call("GET", `/api/projects/${projectId}/datasets`);
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe(1);
  });

  it("changed text creates v2 and v1 cases stay intact", async () => {
    const v1 = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(6) });
    const v2 = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(7, "x") });
    expect(v2.version.version).toBe(2);
    expect(v2.dataset_id).toBe(v1.dataset_id);
    const one = await call("GET", `/api/dataset-versions/${v1.version.id}/cases`);
    const two = await call("GET", `/api/dataset-versions/${v2.version.id}/cases`);
    expect(one).toHaveLength(6);
    expect(one[0].input).toBe("q0");
    expect(two).toHaveLength(7);
    const detail = await call("GET", `/api/datasets/${v1.dataset_id}`);
    expect(detail.versions.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it("an invalid file stores nothing and returns line numbers", async () => {
    const sent = await call("POST", `/api/projects/${projectId}/datasets`, { name: "bad", format: "jsonl", text: '{"input":"a"}\nnot json' });
    expect(sent.problems).toEqual([{ line: 2, message: "not valid JSON" }]);
    expect(await call("GET", `/api/projects/${projectId}/datasets`)).toEqual([]);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM eval_datasets").get()).toEqual({ n: 0 });
  });

  it("refuses a project with the Data factory off", async () => {
    ctx.db.prepare("UPDATE projects SET data_factory = 0 WHERE id = ?").run(projectId);
    expect(await status("GET", `/api/projects/${projectId}/datasets`)).toBe(409);
    expect(await status("POST", `/api/projects/${projectId}/datasets`, { name: "s", format: "jsonl", text: jsonl(1) })).toBe(409);
  });

  it("deleting a dataset removes versions, cases and files", async () => {
    const v1 = await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(6) });
    await call("POST", `/api/projects/${projectId}/datasets`, { name: "set", format: "jsonl", text: jsonl(7, "x") });
    expect(await status("DELETE", `/api/datasets/${v1.dataset_id}`)).toBe(200);
    for (const t of ["eval_datasets", "eval_dataset_versions", "eval_cases"]) {
      expect(ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
    expect(existsSync(join(data, "evals", "datasets", String(v1.dataset_id)))).toBe(false);
  });

  it("imports a CSV with a quoted comma and semicolon tags", async () => {
    const csv = 'input,expected,tags\n"hello, world",greeting,a;b\nbye,farewell,\n';
    const v = await call("POST", `/api/projects/${projectId}/datasets`, { name: "csv", format: "csv", text: csv });
    expect(v.version.case_count).toBe(2);
    const detail = await call("GET", `/api/datasets/${v.dataset_id}`);
    expect(detail.versions).toHaveLength(1);
    const cases = await call("GET", `/api/dataset-versions/${v.version.id}/cases`);
    expect(cases).toHaveLength(2);
    expect(cases[0].input).toBe("hello, world");
    expect(cases[0].tags).toEqual(["a", "b"]);
    expect(cases[0].case_key).toBe("case-1");
    expect(cases[1].tags).toEqual([]);
    expect(cases[1].case_key).toBe("case-2");
  });

  it("keeps ä ö å in a JSONL import", async () => {
    const text = JSON.stringify({ input: "Käyttäjä äöå", expected: "Ääkköset" });
    const v = await call("POST", `/api/projects/${projectId}/datasets`, { name: "nordic", format: "jsonl", text });
    const cases = await call("GET", `/api/dataset-versions/${v.version.id}/cases`);
    expect(cases[0].input).toBe("Käyttäjä äöå");
    expect(cases[0].expected).toBe("Ääkköset");
  });

  it("cases paging respects offset and the limit of 200", async () => {
    const v = await call("POST", `/api/projects/${projectId}/datasets`, { name: "big", format: "jsonl", text: jsonl(250) });
    const page = await call("GET", `/api/dataset-versions/${v.version.id}/cases?offset=10&limit=5`);
    expect(page.map((c: any) => c.input)).toEqual(["q10", "q11", "q12", "q13", "q14"]);
    const capped = await call("GET", `/api/dataset-versions/${v.version.id}/cases?limit=1000`);
    expect(capped).toHaveLength(200);
  });
});
