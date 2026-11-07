import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";
import { DEFAULT_SETTINGS } from "../src/db.ts";

describe("sign-in", () => {
  it("pauses sign-in after five wrong passwords, even for the right one", async () => {
    const ctx = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-auth-")) });
    const post = (url: string, payload: unknown) => ctx.app.inject({ method: "POST", url, headers: { host: "localhost" }, payload: payload as object });
    expect((await post("/api/auth/setup", { username: "jan", password: "password123" })).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await post("/api/auth/login", { username: "jan", password: "wrong-one" })).statusCode).toBe(401);
    const locked = await post("/api/auth/login", { username: "jan", password: "password123" });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatch(/Too many wrong passwords/);
    await ctx.app.close();
  }, 20000);

  it("starts with spending limits switched on", () => {
    expect(Number(DEFAULT_SETTINGS.budget_day_usd)).toBeGreaterThan(0);
    expect(Number(DEFAULT_SETTINGS.budget_sprint_usd)).toBeGreaterThan(0);
  });
});
