import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";

describe("usage by kind of work", () => {
  let data: string, ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string;
  const get = async (url: string) => (await ctx.app.inject({ method: "GET", url, headers: { cookie, host: "localhost" } }));
  const kindsOf = (u: any) => u.byKind.map((k: any) => k.kind).sort();
  const today = () => new Date().toISOString().slice(0, 10);

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-usage-"));
    ctx = await buildApp({ dataDir: data });
    const s = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(s.headers["set-cookie"]).split(";")[0];
    const ins = ctx.db.prepare("INSERT INTO runs (kind, engine, status, cost_usd, started_at) VALUES (?, ?, 'ok', ?, datetime('now'))");
    ins.run("build", "anthropic", 1);
    ins.run("review", "anthropic", 2);
    ins.run("plan", "anthropic", 4);
    ins.run("eval", "anthropic", 8);
    ins.run("judge", "anthropic", 16);
    ins.run("checks", "shell", 32);
  });
  afterEach(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const cases: [string | undefined, string[], number][] = [
    ["tasks", ["build", "review"], 3],
    ["planning", ["plan"], 4],
    ["eval", ["eval"], 8],
    ["judge", ["judge"], 16],
    ["factory", ["eval", "judge"], 24],
    ["nonsense", ["build", "eval", "judge", "plan", "review"], 31],
    [undefined, ["build", "eval", "judge", "plan", "review"], 31],
  ];

  for (const [group, kinds, cost] of cases) {
    it(`group ${group ?? "(none)"} returns exactly its rows`, async () => {
      const q = group ? `&group=${group}` : "";
      const u = (await get(`/api/usage?days=30${q}`)).json();
      expect(kindsOf(u)).toEqual(kinds);
      expect(u.totals.runs).toBe(kinds.length);
      expect(u.totals.cost_usd).toBe(cost);
      expect(u.daily.reduce((n: number, d: any) => n + d.runs, 0)).toBe(kinds.length);
      expect(u.byAgent.reduce((n: number, d: any) => n + d.runs, 0)).toBe(0); // runs here have no agent
      expect(u.byModel.reduce((n: number, d: any) => n + d.runs, 0)).toBe(kinds.length);
      expect(u.byProject.reduce((n: number, d: any) => n + d.runs, 0)).toBe(kinds.length);

      const log = (await get(`/api/usage/runs?day=${today()}${q}`)).json();
      expect(log.map((r: any) => r.kind).sort()).toEqual(kinds);

      const csv = (await get(`/api/usage/export.csv?days=0${q}`)).body.split("\r\n").slice(1);
      expect(csv.length).toBe(kinds.length);
      for (const k of kinds) expect(csv.some((line: string) => line.split(",")[3] === k)).toBe(true);
    });
  }
});
