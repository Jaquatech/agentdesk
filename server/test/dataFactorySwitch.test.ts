import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";

describe("Data factory switch on projects", () => {
  let data: string, folder: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    folder = mkdtempSync(join(tmpdir(), "ad-project-"));
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => (await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
  });

  afterEach(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const listed = async (id: number) => (await call("GET", "/api/projects")).find((p: any) => p.id === id);

  it("is off for a new project", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: folder });
    expect((await listed(project.id)).data_factory).toBe(0);
  });

  it("turns on by update and the list returns it", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: folder });
    await call("PUT", `/api/projects/${project.id}`, { name: "demo", source: "local", path: folder, data_factory: 1 });
    expect((await listed(project.id)).data_factory).toBe(1);
  });

  it("stores any value other than 1 as 0", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: folder, data_factory: 1 });
    expect((await listed(project.id)).data_factory).toBe(1);
    await call("PUT", `/api/projects/${project.id}`, { name: "demo", source: "local", path: folder, data_factory: 7 });
    expect((await listed(project.id)).data_factory).toBe(0);
  });
});
