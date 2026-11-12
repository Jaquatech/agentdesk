import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";

describe("documents", () => {
  it("seeds the two guides and stores project and generic pages", async () => {
    const ctx = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-docs-")) });
    const app = ctx.app;
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
      return { status: r.statusCode, body: r.json() as Record<string, any> };
    };

    const list = await call("GET", "/api/documents");
    expect(list.status).toBe(200);
    const rows = list.body as unknown as { id: number; builtin: string | null; kind: string }[];
    expect(rows.map((d) => d.builtin).filter(Boolean).sort()).toEqual(["cycle", "models"]);
    expect(rows.filter((d) => d.builtin).every((d) => d.kind === "generic")).toBe(true);

    const cycle = rows.find((d) => d.builtin === "cycle")!;
    const one = await call("GET", `/api/documents/${cycle.id}`);
    expect(one.status).toBe(200);
    expect(one.body.body).toMatch(/Run plan/);
    expect(one.body.body).toMatch(/Choosing AI models/);

    const folder = mkdtempSync(join(tmpdir(), "ad-docs-proj-"));
    const project = await call("POST", "/api/projects", { name: "Demo", source: "local", path: folder });
    expect(project.status).toBe(200);
    const page = await call("POST", "/api/documents", { title: "How we ship", body: "Small tasks.", project_id: project.body.id });
    expect(page.status).toBe(200);
    expect(page.body.kind).toBe("project");
    expect(page.body.project_name).toBe("Demo");

    const shared = await call("POST", "/api/documents", { title: "House style", body: "Prefer short functions." });
    expect(shared.body.kind).toBe("generic");
    expect(shared.body.project_id).toBeNull();

    const renamed = await call("PUT", `/api/documents/${shared.body.id}`, { title: "House style", body: "Prefer short functions. Name things plainly." });
    expect(renamed.body.body).toMatch(/plainly/);

    expect((await call("DELETE", `/api/documents/${one.body.id}`)).status).toBe(400);
    expect((await call("DELETE", `/api/documents/${shared.body.id}`)).status).toBe(200);
    expect((await call("GET", `/api/documents/${shared.body.id}`)).status).toBe(404);
    expect((await call("POST", "/api/documents", { title: "Missing", project_id: 99999 })).status).toBe(404);

    await app.close();
  });
});
