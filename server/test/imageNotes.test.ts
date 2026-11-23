import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import { openDb, type DB } from "../src/db.ts";
import { attachmentPrompt, storeImageNotes, type PromptAttachments } from "../src/attachments.ts";
import { earlierFileSummary } from "../src/attachmentMarkdown.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0, tokensIn: 10, cacheRead: 0, cacheWrite: 0, tokensOut: 5, seconds: 0 });

const empty = (): PromptAttachments => ({ images: [], texts: [], skipped: [], paths: [], readPaths: [], notes: [] });

function tempDb(): DB {
  return openDb(join(mkdtempSync(join(tmpdir(), "ad-imgnote-")), "t.db"));
}

/** A chat in a project, with one user message per entry in `messages` (each with the given attachments). */
function seed(db: DB) {
  const project = Number(db.prepare("INSERT INTO projects (name, source, path) VALUES ('p', 'local', '/tmp/p')").run().lastInsertRowid);
  const chat = Number(db.prepare("INSERT INTO chats (project_id, title) VALUES (?, 'c')").run(project).lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO chats (project_id, title) VALUES (?, 'other')").run(project).lastInsertRowid);
  const message = (chatId: number) => Number(db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', 'x')").run(chatId).lastInsertRowid);
  const file = (chatId: number, messageId: number | null, name: string, mime = "image/png") =>
    Number(db.prepare("INSERT INTO attachments (chat_id, message_id, name, mime, size, path) VALUES (?, ?, ?, ?, 10, '')")
      .run(chatId, messageId, name, mime).lastInsertRowid);
  return { chat, other, message, file };
}

const noteOf = (db: DB, id: number) => (db.prepare("SELECT image_note FROM attachments WHERE id = ?").get(id) as { image_note: string }).image_note;

describe("storeImageNotes", () => {
  it("stores a note on the newest image of that name without one, and returns its message id", () => {
    const db = tempDb();
    const s = seed(db);
    const m1 = s.message(s.chat), m2 = s.message(s.chat);
    const a1 = s.file(s.chat, m1, "a.png"), a2 = s.file(s.chat, m2, "a.png");

    expect(storeImageNotes(db, s.chat, [{ name: "a.png", note: "red error banner" }])).toEqual([m2]);
    expect(noteOf(db, a2)).toBe("red error banner");
    expect(noteOf(db, a1)).toBe("");

    // The next note for the same name goes to the next older image that has none.
    expect(storeImageNotes(db, s.chat, [{ name: "a.png", note: "blue chart" }])).toEqual([m1]);
    expect(noteOf(db, a1)).toBe("blue chart");

    // Nothing left without a note: nothing is returned, and the existing note is kept.
    expect(storeImageNotes(db, s.chat, [{ name: "a.png", note: "third" }])).toEqual([]);
    expect(noteOf(db, a2)).toBe("red error banner");
  });

  it("ignores what is not a usable entry", () => {
    const db = tempDb();
    const s = seed(db);
    const m = s.message(s.chat);
    const a = s.file(s.chat, m, "a.png");
    const elsewhere = s.file(s.other, s.message(s.other), "b.png");
    const doc = s.file(s.chat, m, "c.pdf", "application/pdf");

    expect(storeImageNotes(db, s.chat, "not an array")).toEqual([]);
    expect(storeImageNotes(db, s.chat, null)).toEqual([]);
    expect(storeImageNotes(db, s.chat, [{ name: "a.png" }, { name: "a.png", note: 5 }, { name: 3, note: "x" }, null])).toEqual([]);
    expect(storeImageNotes(db, s.chat, [{ name: "a.png", note: "   " }])).toEqual([]);
    expect(storeImageNotes(db, s.chat, [{ name: "unknown.png", note: "x" }])).toEqual([]);
    expect(storeImageNotes(db, s.chat, [{ name: "b.png", note: "other chat" }])).toEqual([]);
    expect(storeImageNotes(db, s.chat, [{ name: "c.pdf", note: "not an image" }])).toEqual([]);
    expect(noteOf(db, a)).toBe("");
    expect(noteOf(db, doc)).toBe("");
    expect(noteOf(db, elsewhere)).toBe("");
  });

  it("cuts a note to 300 characters and uses at most 10 entries", () => {
    const db = tempDb();
    const s = seed(db);
    const ids: number[] = [];
    for (let i = 0; i < 11; i++) ids.push(s.file(s.chat, s.message(s.chat), `n${i}.png`));

    const long = "x".repeat(400);
    storeImageNotes(db, s.chat, [{ name: "n0.png", note: long }]);
    expect(noteOf(db, ids[0])).toHaveLength(300);

    const many = Array.from({ length: 11 }, (_, i) => ({ name: `n${i}.png`, note: `note ${i}` }));
    storeImageNotes(db, s.chat, many);
    expect(noteOf(db, ids[9])).toBe("note 9");
    expect(noteOf(db, ids[10])).toBe("");
  });
});

describe("the prompt asks for image notes", () => {
  it("adds the request only when an image is attached", () => {
    const withImage = { ...empty(), images: [{ name: "a.png", mime: "image/png", base64: "" }] };
    expect(attachmentPrompt(withImage)).toContain("image_notes");
    expect(attachmentPrompt(withImage)).toContain("- a.png (image, shown below)");

    const textOnly = { ...empty(), texts: [{ name: "n.txt", content: "hello", part: 1, parts: 1 }] };
    expect(attachmentPrompt(textOnly)).not.toContain("image_notes");
  });
});

describe("earlier files show the image note", () => {
  it("uses the note in place of the size and parts", () => {
    const row = { id: 1, name: "a.png", size: 2048, path: "", status: "", image_note: "login error 500" };
    expect(earlierFileSummary([row])).toContain('image: "login error 500"');
    expect(earlierFileSummary([{ ...row, image_note: "" }])).not.toContain("image:");
    expect(earlierFileSummary([{ ...row, image_note: "" }])).toContain("2 KB");
  });
});

describe("image notes through a chat", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let cookie: string;
  const plans: EngineRequest[] = [];

  function gitRepo() {
    const dir = mkdtempSync(join(tmpdir(), "ad-imgnote-repo-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
    g("init", "-q", "-b", "main");
    writeFileSync(join(dir, "README.md"), "# demo\n");
    g("add", "-A");
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
    return dir;
  }

  async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 20000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-imgnote-data-"));
    repo = gitRepo();
    plans.length = 0;
    engineOverride.engine = { run: async (req) => {
      if (req.output?.name === "submit_plan") {
        plans.push(req);
        return ok("p", { reply: "ok", tasks: [], image_notes: plans.length === 1 ? [{ name: "screen.png", note: "red error banner" }] : [] });
      }
      return ok("x", { reply: "ok", tasks: [] });
    } };
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => (await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    await call("POST", "/api/agents", { name: "Ada", role: "planner", provider_id: prov.id });
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function upload(chatId: number, name: string, type: string, body: Buffer) {
    return (await ctx.app.inject({
      method: "POST", url: `/api/chats/${chatId}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      headers: { cookie, host: "localhost", "content-type": "application/octet-stream" }, payload: body,
    })).json();
  }

  it("stores the note the agent wrote, shows it, and gives it to the next prompt instead of the image", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const png = await upload(chat.id, "screen.png", "image/png", Buffer.from("89504e470d0a1a0a", "hex"));

    await call("POST", `/api/chats/${chat.id}/messages`, { content: "what is wrong here?", attachment_ids: [png.id] });
    const withNote = await waitFor(async () => {
      const c = await call("GET", `/api/chats/${chat.id}`);
      const file = c.messages.flatMap((m: any) => m.attachments).find((a: any) => a.id === png.id);
      return file?.image_note ? file : undefined;
    });
    expect(withNote.image_note).toBe("red error banner");

    await call("POST", `/api/chats/${chat.id}/messages`, { content: "and now?" });
    await waitFor(async () => (plans.length === 2 ? true : undefined));
    expect(plans[1].prompt).toContain('image: "red error banner"');
  }, 30000);
});
