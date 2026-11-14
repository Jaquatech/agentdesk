import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";
import { applyWikiWrites, projectWikiContext, seedDocuments } from "../src/documents.ts";
import { runTool } from "../src/engines/tools.ts";

describe("documents", () => {
  it("keeps general guides and gives each project its pages, task pages, and links", async () => {
    const ctx = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-docs-")) });
    const app = ctx.app;
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
      return { status: r.statusCode, body: r.json() as any };
    };

    const list = await call("GET", "/api/documents");
    expect(list.status).toBe(200);
    const rows = list.body as { id: number; title: string; builtin: string | null; kind: string; body?: string }[];
    expect(rows.map((d) => d.builtin).filter(Boolean).sort()).toEqual(["cycle", "guidelines", "models", "standards", "ui"]);
    expect(rows.filter((d) => d.builtin).every((d) => d.kind === "generic")).toBe(true);
    expect(rows.find((d) => d.builtin === "guidelines")!.title).toBe("Coding guidelines");

    const cycle = rows.find((d) => d.builtin === "cycle")!;
    const one = await call("GET", `/api/documents/${cycle.id}`);
    expect(one.status).toBe(200);
    expect(one.body.body).toMatch(/Run plan/);
    expect(one.body.body).toMatch(/Choosing AI models/);
    const guide = await call("GET", `/api/documents/${rows.find((d) => d.builtin === "guidelines")!.id}`);
    expect(guide.body.body).toMatch(/Testing/);
    expect(guide.body.body).not.toMatch(/Demo/);

    const folder = mkdtempSync(join(tmpdir(), "ad-docs-proj-"));
    const project = await call("POST", "/api/projects", { name: "Demo", source: "local", path: folder });
    expect(project.status).toBe(200);
    const after = (await call("GET", "/api/documents")).body as { id: number; title: string; project_id: number | null; slot: string; section: string; task_id: number | null }[];
    const mine = after.filter((d) => d.project_id === project.body.id);
    expect(mine.map((d) => d.slot).filter(Boolean).sort()).toEqual(["architecture", "overview", "roadmap", "setup"]);
    expect(mine.some((d) => d.section === "decisions" || d.section === "releases")).toBe(false);
    const overview = mine.find((d) => d.slot === "overview")!;
    const architecture = mine.find((d) => d.slot === "architecture")!;

    // A project that already existed when the wiki structure arrived gets the same pages.
    const laterId = Number(ctx.db.prepare("INSERT INTO projects (name, source, path) VALUES ('Later', 'local', ?)").run(folder).lastInsertRowid);
    const laterChat = Number(ctx.db.prepare("INSERT INTO chats (project_id, title) VALUES (?, 'Notes')").run(laterId).lastInsertRowid);
    ctx.db.prepare("INSERT INTO tasks (chat_id, project_id, slug, title, spec) VALUES (?, ?, 'note', 'Write the note', 'One sentence.')").run(laterChat, laterId);
    seedDocuments(ctx.db);
    const later = ctx.db.prepare("SELECT slot FROM documents WHERE project_id = (SELECT id FROM projects WHERE name = 'Later') AND slot != ''").all() as { slot: string }[];
    expect(later.map((d) => d.slot).sort()).toEqual(["architecture", "overview", "roadmap", "setup"]);
    const laterTask = ctx.db.prepare("SELECT title, body FROM documents WHERE task_id = (SELECT id FROM tasks WHERE slug = 'note')").get() as { title: string; body: string };
    expect(laterTask.title).toBe("Write the note");
    expect(laterTask.body).toMatch(/One sentence/);
    expect(laterTask.body).not.toMatch(/TODO|lorem|example customer/i);

    expect((await call("POST", "/api/documents", { title: "Second overview", body: "no", project_id: project.body.id, section: "overview" })).status).toBe(400);
    const decision = await call("POST", "/api/documents", { title: "Use a queue", body: "One queue.", project_id: project.body.id, section: "decisions" });
    expect(decision.status).toBe(200);
    expect(decision.body.section).toBe("decisions");

    const page = await call("POST", "/api/documents", { title: "How we ship", body: `Small tasks. See #/documents/${overview.id} and doc:${architecture.id}`, project_id: project.body.id });
    expect(page.body.kind).toBe("project");
    expect(page.body.project_name).toBe("Demo");
    const linked = await call("GET", `/api/documents/${page.body.id}`);
    expect(linked.body.links.map((l: { id: number }) => l.id).sort()).toEqual([overview.id, architecture.id].sort());
    const back = await call("GET", `/api/documents/${architecture.id}`);
    expect(back.body.backlinks.map((l: { id: number }) => l.id)).toContain(page.body.id);

    const shared = await call("POST", "/api/documents", { title: "House style", body: "Prefer short functions." });
    expect(shared.body.kind).toBe("generic");
    expect(shared.body.project_id).toBeNull();
    const renamed = await call("PUT", `/api/documents/${shared.body.id}`, { title: "House style", body: "Prefer short functions. Name things plainly." });
    expect(renamed.body.body).toMatch(/plainly/);

    const chat = ctx.db.prepare("INSERT INTO chats (project_id, title) VALUES (?, 'Main')").run(project.body.id);
    const task = ctx.db.prepare("INSERT INTO tasks (chat_id, project_id, slug, title, spec, summary, review, verdict) VALUES (?, ?, 'button', 'Add a button', 'Show a button.', 'Added it.', 'Fine.', 'approve')")
      .run(Number(chat.lastInsertRowid), project.body.id);
    const taskId = Number(task.lastInsertRowid);
    ctx.orch.updateTask(taskId, {});
    const taskPage = ctx.db.prepare("SELECT id, title, body, section FROM documents WHERE task_id = ?").get(taskId) as { id: number; title: string; body: string; section: string };
    expect(taskPage.title).toBe("Add a button");
    expect(taskPage.section).toBe("tasks");
    expect(taskPage.body).toMatch(/Show a button/);
    expect(taskPage.body).toMatch(/Added it/);
    expect(taskPage.body).toMatch(/Approved/);
    expect(taskPage.body).toMatch(/Fine/);
    expect(taskPage.body).not.toMatch(/invented/);

    const edited = await call("PUT", `/api/documents/${taskPage.id}`, {
      title: "Add a button",
      body: "## Spec\n\nShow a labelled button.\n\n## Developer's summary\n\nAdded it.\n\n## Review\n\nApproved.\n\nFine.\n",
    });
    expect(edited.status).toBe(200);
    const taskRow = ctx.db.prepare("SELECT spec FROM tasks WHERE id = ?").get(taskId) as { spec: string };
    expect(taskRow.spec).toBe("Show a labelled button.");
    const viaApi = await call("GET", `/api/tasks/${taskId}`);
    expect(viaApi.body.task.document_id).toBe(taskPage.id);
    expect(viaApi.body.task.spec).toBe("Show a labelled button.");

    ctx.orch.updateTask(taskId, { summary: "Added the label.", verdict: "changes", review: "Rename the control." });
    const synced = await call("GET", `/api/documents/${taskPage.id}`);
    expect(synced.body.body).toMatch(/Added the label/);
    expect(synced.body.body).toMatch(/Changes asked/);
    expect(synced.body.body).toMatch(/Rename the control/);
    expect(synced.body.body).toMatch(/Show a labelled button/);

    const wrote = applyWikiWrites(ctx.db, project.body.id, [
      { title: "Overview", section: "overview", body: "A small tool for local work." },
      { title: "Ship on Fridays", section: "decisions", body: "Friday is the release day." },
      { title: "Coding guidelines", section: "generic", body: "LEAK the project name Demo" },
    ]);
    expect(wrote).toBe(2);
    const overviewBody = ctx.db.prepare("SELECT body FROM documents WHERE id = ?").get(overview.id) as { body: string };
    expect(overviewBody.body).toBe("A small tool for local work.");
    const guideAfter = ctx.db.prepare("SELECT body FROM documents WHERE builtin = 'guidelines'").get() as { body: string };
    expect(guideAfter.body).not.toMatch(/LEAK/);
    expect(guideAfter.body).not.toMatch(/Demo/);
    const wiki = projectWikiContext(ctx.db, project.body.id);
    expect(wiki).toMatch(/A small tool/);
    expect(wiki).toMatch(/Add a button/);
    expect(wiki).not.toMatch(/Coding guidelines/);
    expect(wiki).not.toMatch(/Choosing AI models/);

    const tool = await runTool("write_wiki", { title: "Setup", section: "setup", body: "Run the app from the project folder." }, {
      cwd: folder, canWrite: true, commandPrefixes: [],
      writeWiki: (p) => (applyWikiWrites(ctx.db, project.body.id, [p]) ? "updated" : "refused"),
    });
    expect(tool.content).toBe("updated");
    expect((ctx.db.prepare("SELECT body FROM documents WHERE id = ?").get(mine.find((d) => d.slot === "setup")!.id) as { body: string }).body).toMatch(/project folder/);
    const refused = await runTool("write_wiki", { title: "Nope", section: "setup", body: "x" }, { cwd: folder, canWrite: true, commandPrefixes: [] });
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/cannot edit the wiki/);

    expect((await call("DELETE", `/api/documents/${one.body.id}`)).status).toBe(400);
    expect((await call("DELETE", `/api/documents/${overview.id}`)).status).toBe(400);
    expect((await call("DELETE", `/api/documents/${taskPage.id}`)).status).toBe(400);
    expect((await call("DELETE", `/api/documents/${decision.body.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/documents/${shared.body.id}`)).status).toBe(200);
    expect((await call("GET", `/api/documents/${shared.body.id}`)).status).toBe(404);
    expect((await call("POST", "/api/documents", { title: "Missing", project_id: 99999 })).status).toBe(404);

    await app.close();
  });
});
