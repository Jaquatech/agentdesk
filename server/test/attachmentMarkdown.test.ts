import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import { convertUpload, formatPart, sheetsToMarkdown, splitParts, PART_CHARS, SHEET_COL_CAP, SHEET_ROW_CAP, readChatAttachment } from "../src/attachmentMarkdown.ts";
import { runTool } from "../src/engines/tools.ts";
import { DemoEngine } from "../src/engines/demo.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "attachments");
const fixture = (name: string) => readFileSync(join(fixtures, name));

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0, tokensIn: 10, cacheRead: 0, cacheWrite: 0, tokensOut: 5, seconds: 0 });

describe("text attachments become Markdown", () => {
  it("copies each text type, and adds columns and a row count for CSV and TSV", async () => {
    const csv = await convertUpload("sample.csv", "text/csv", fixture("sample.csv"));
    expect(csv?.status).toBe("converted");
    expect(csv?.markdown?.startsWith("Columns: name, qty, note\nRows: 2 (not counting the header)\n\n")).toBe(true);
    expect(csv?.markdown).toContain("hello, world");
    const csvBody = csv?.markdown?.slice(csv.markdown.indexOf("name,qty")) ?? "";
    expect(Buffer.from(csvBody).equals(fixture("sample.csv"))).toBe(true);

    const tsv = await convertUpload("sample.tsv", "text/tab-separated-values", fixture("sample.tsv"));
    expect(tsv?.status).toBe("converted");
    expect(tsv?.markdown).toContain("Columns: name, qty");
    expect(tsv?.markdown).toContain("Rows: 2 (not counting the header)");
    expect(tsv?.markdown).toContain("Ada\t2");

    for (const [name, mime] of [
      ["sample.txt", "text/plain"],
      ["sample.md", "text/markdown"],
      ["sample.json", "application/json"],
      ["sample.xml", "application/xml"],
    ] as const) {
      const out = await convertUpload(name, mime, fixture(name));
      expect(out?.status, name).toBe("converted");
      expect(out?.markdown, name).toBe(fixture(name).toString("utf8"));
      expect(out?.markdown, name).not.toContain("Columns:");
    }
    // *.log is gitignored, so this one is written in the test rather than stored as a fixture.
    const log = await convertUpload("app.log", "text/plain", Buffer.from("ERROR at line 3\n"));
    expect(log).toEqual({ status: "converted", markdown: "ERROR at line 3\n" });

    // Source files were already treated as text. They stay a plain copy, with no table header.
    const py = await convertUpload("main.py", "text/x-python", Buffer.from("print(1)\n"));
    expect(py).toEqual({ status: "converted", markdown: "print(1)\n" });
    // Old binary Excel is not the xlsx reader. It stays unconverted.
    expect(await convertUpload("legacy.xls", "application/vnd.ms-excel", Buffer.from("not xlsx"))).toBeNull();
  });

  it("turns a workbook into one table per sheet and says what was cut", async () => {
    const book = await convertUpload("sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fixture("sample.xlsx"));
    expect(book?.status).toBe("converted");
    expect(book?.markdown).toContain("## Prices");
    expect(book?.markdown).toContain("copper-wire");
    expect(book?.markdown).toContain("17");
    expect(book?.markdown).toContain("## Notes");
    const wide = Array.from({ length: SHEET_COL_CAP + 2 }, (_, i) => `c${i}`);
    const rows = [["h"], ...Array.from({ length: SHEET_ROW_CAP - 1 }, () => ["kept"]), ["CUT-ME"]];
    const cut = sheetsToMarkdown([{ name: "Big", rows }, { name: "Wide", rows: [wide] }]);
    expect(cut.status).toBe("truncated");
    expect(cut.markdown).toContain("Cut 1 row.");
    expect(cut.markdown).toContain("Cut 2 columns.");
    expect(cut.markdown).not.toContain("CUT-ME");
    expect(cut.markdown).not.toContain("c21");
  });

  it("turns a Word file into headings, paragraphs, lists and tables", async () => {
    const doc = await convertUpload("sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fixture("sample.docx"));
    expect(doc?.status).toBe("converted");
    expect(doc?.markdown).toContain("# Gasket");
    expect(doc?.markdown).toContain("The gasket code is K-19.");
    expect(doc?.markdown).toMatch(/\* seal/);
    expect(doc?.markdown).toContain("stock");
    expect(doc?.markdown).toContain("K-19");
  });

  it("keeps PDF text per page, and marks a page with no text as needing a scan", async () => {
    const pdf = await convertUpload("sample.pdf", "application/pdf", fixture("sample.pdf"));
    expect(pdf?.status).toBe("converted");
    expect(pdf?.markdown).toContain("## Page 1");
    expect(pdf?.markdown).toContain("threshold 42");
    expect(pdf?.markdown).toContain("## Page 2");
    expect(pdf?.markdown).toContain("page two spare");
    const scan = await convertUpload("scan.pdf", "application/pdf", fixture("scan.pdf"));
    expect(scan).toEqual({ status: "needs_ocr", markdown: null });
  });

  it("reports a broken file as failed and does not invent a copy", async () => {
    const broken = await convertUpload("notes.txt", "text/plain", Buffer.from([0xff, 0xfe, 0xfd]));
    expect(broken).toEqual({ status: "failed: not valid UTF-8", markdown: null });
    const badXlsx = await convertUpload("bad.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from("this is not a real file"));
    const badDocx = await convertUpload("bad.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("this is not a real file"));
    const badPdf = await convertUpload("bad.pdf", "application/pdf", Buffer.from("this is not a real file"));
    for (const result of [badXlsx, badDocx, badPdf]) {
      expect(result?.status.startsWith("failed: ")).toBe(true);
      expect(result?.markdown).toBeNull();
    }
    expect(badXlsx?.status).not.toMatch(/https?:/);
    expect(badDocx?.status).not.toMatch(/https?:/);
  });

  it("returns every part once", () => {
    const body = `${"a".repeat(PART_CHARS - 10)}\n${"b".repeat(PART_CHARS)}\n${"c".repeat(50)}`;
    const parts = splitParts(body);
    expect(parts.join("")).toBe(body);
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part, i) => {
      const formatted = formatPart(body, i + 1);
      expect(formatted.startsWith(`part ${i + 1} of ${parts.length}\n\n`)).toBe(true);
      expect(formatted.slice(formatted.indexOf("\n\n") + 2)).toBe(part);
    });
    expect(() => formatPart(body, parts.length + 1)).toThrow(/outside 1 to/);
    expect(splitParts("").join("")).toBe("");
    expect(formatPart("", 1)).toBe("part 1 of 1\n\n");
  });
});

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-att-md-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

describe("attachment markdown in a chat", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let cookie: string;
  let seen: EngineRequest | undefined;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    repo = gitRepo();
    seen = undefined;
    engineOverride.engine = { run: async (req) => { seen = req; return ok("p", { reply: "ok", tasks: [] }); } };
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

  async function waitFor<T>(fn: () => T | undefined, ms = 15000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  it("keeps the original, writes the copy, and still sends a message when conversion fails", async () => {
    const project = await call("POST", "/api/projects", { name: "att", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const csv = await upload(chat.id, "sample.csv", "text/csv", fixture("sample.csv"));
    const row = ctx.db.prepare("SELECT id, path, status FROM attachments WHERE id = ?").get(csv.id) as { id: number; path: string; status: string };
    expect(row.status).toBe("converted");
    expect(readFileSync(row.path).equals(fixture("sample.csv"))).toBe(true);
    const copy = join(dirname(row.path), `${row.id}.md`);
    expect(readFileSync(copy, "utf8")).toContain("Columns: name, qty, note");

    const broken = await upload(chat.id, "broken.txt", "text/plain", Buffer.from([0xff, 0xfe, 0xfd]));
    expect(broken.status).toBe("failed: not valid UTF-8");
    expect(existsSync(join(dirname(row.path), `${broken.id}.md`))).toBe(false);

    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "please look", attachment_ids: [csv.id, broken.id] });
    const req = await waitFor(() => seen);
    expect(req.attachments?.texts.map((t) => t.content).join("\n")).toContain("hello, world");
    expect(req.attachments?.texts[0].parts).toBe(1);
    expect(req.attachments?.skipped.join("\n")).toContain("not valid UTF-8");
    expect(req.readAttachment).toBeTypeOf("function");
    const view = await call("GET", `/api/chats/${chat.id}`);
    const message = view.messages.find((m: { role: string }) => m.role === "user");
    expect(message.content).toBe("please look");
    expect(message.attachments.find((a: { name: string }) => a.name === "sample.csv").status).toBe("converted");
    expect(message.attachments.find((a: { name: string }) => a.name === "broken.txt").status).toBe("failed: not valid UTF-8");
    expect(message.attachments.find((a: { name: string }) => a.name === "broken.txt").note).toContain("not valid UTF-8");
  });

  it("still sends the message when an Excel, Word or PDF file cannot be read", async () => {
    const project = await call("POST", "/api/projects", { name: "office", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const xlsx = await upload(chat.id, "sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fixture("sample.xlsx"));
    const docx = await upload(chat.id, "sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fixture("sample.docx"));
    const pdf = await upload(chat.id, "sample.pdf", "application/pdf", fixture("sample.pdf"));
    const scan = await upload(chat.id, "scan.pdf", "application/pdf", fixture("scan.pdf"));
    const junk = await upload(chat.id, "broken.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from("this is not a real file"));
    expect(xlsx.status).toBe("converted");
    expect(docx.status).toBe("converted");
    expect(pdf.status).toBe("converted");
    expect(scan.status).toBe("needs_ocr");
    expect(junk.status.startsWith("failed: ")).toBe(true);
    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "quote the files", attachment_ids: [xlsx.id, docx.id, pdf.id, scan.id, junk.id] });
    const req = await waitFor(() => seen);
    const quoted = req.attachments?.texts.map((t) => t.content).join("\n") ?? "";
    expect(quoted).toContain("copper-wire");
    expect(quoted).toContain("K-19");
    expect(quoted).toContain("threshold 42");
    expect(quoted).toContain("page two spare");
    expect(req.attachments?.skipped.join("\n")).toContain("no text layer");
    expect(req.attachments?.skipped.join("\n")).toContain("broken.xlsx");
    const view = await call("GET", `/api/chats/${chat.id}`);
    const message = view.messages.find((m: { role: string }) => m.role === "user");
    expect(message.content).toBe("quote the files");
    expect(message.attachments.find((a: { name: string }) => a.name === "scan.pdf").status).toBe("needs_ocr");
    expect(message.attachments.find((a: { name: string }) => a.name === "scan.pdf").note).toBe("scan.pdf not sent: no text layer");
    expect(message.attachments.find((a: { name: string }) => a.name === "broken.xlsx").status.startsWith("failed: ")).toBe(true);
  });

  it("pages a long copy, refuses another chat's file and a path, and clearing removes the copies", async () => {
    const project = await call("POST", "/api/projects", { name: "att", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const other = await call("POST", "/api/chats", { project_id: project.id });
    const body = Buffer.from(`${"row\n".repeat(12_000)}end\n`);
    const file = await upload(chat.id, "long.txt", "text/plain", body);
    const secret = await upload(other.id, "secret.txt", "text/plain", Buffer.from("other chat"));
    const own = readChatAttachment(ctx.db, chat.id, "long.txt", 1);
    expect(own.startsWith("part 1 of ")).toBe(true);
    expect(own).not.toContain("other chat");
    expect(() => readChatAttachment(ctx.db, chat.id, "secret.txt", 1)).toThrow(/this chat/);
    expect(() => readChatAttachment(ctx.db, chat.id, "../secret.txt", 1)).toThrow(/not a path/);
    const otherText = readChatAttachment(ctx.db, other.id, "secret.txt", 1);
    expect(otherText).toContain("other chat");
    expect(otherText).not.toContain("end");

    const parts = Number(/part 1 of (\d+)/.exec(own)?.[1]);
    expect(parts).toBeGreaterThan(1);
    let joined = "";
    for (let n = 1; n <= parts; n++) {
      const got = readChatAttachment(ctx.db, chat.id, "long.txt", n);
      expect(got.startsWith(`part ${n} of ${parts}\n\n`)).toBe(true);
      joined += got.slice(got.indexOf("\n\n") + 2);
    }
    const copy = join(data, "attachments", String(chat.id), `${file.id}.md`);
    expect(joined).toBe(readFileSync(copy, "utf8"));
    expect(joined).toBe(body.toString("utf8"));

    const refused = await runTool("read_attachment", { name: "secret.txt" }, {
      cwd: repo, canWrite: false, commandPrefixes: [],
      readAttachment: (name, part) => readChatAttachment(ctx.db, chat.id, name, part),
    });
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/this chat/);

    ctx.orch.start();
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "first", attachment_ids: [file.id] });
    await waitFor(() => seen);
    const second = await upload(chat.id, "later.txt", "text/plain", Buffer.from("later"));
    seen = undefined;
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "second", attachment_ids: [second.id] });
    const req = await waitFor(() => seen);
    expect(req.prompt).toContain("attached earlier: long.txt");
    expect(req.prompt).toMatch(/long\.txt, \d+ KB, \d+ parts/);
    expect(req.prompt).not.toContain("row\nrow");

    expect(existsSync(copy)).toBe(true);
    const cleared = await call("DELETE", "/api/attachments-cache");
    expect(cleared.removed).toBeGreaterThan(0);
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(join(data, "attachments", String(other.id), `${secret.id}.md`))).toBe(false);
  });

  it("removes the Markdown copy when the chat is deleted", async () => {
    const project = await call("POST", "/api/projects", { name: "att", source: "local", path: repo });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const file = await upload(chat.id, "sample.txt", "text/plain", fixture("sample.txt"));
    const copy = join(data, "attachments", String(chat.id), `${file.id}.md`);
    expect(existsSync(copy)).toBe(true);
    await call("DELETE", `/api/chats/${chat.id}`);
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(join(data, "attachments", String(chat.id)))).toBe(false);
  });
});

describe("demo read_attachment", () => {
  it("calls the tool when the user asks for an attachment by name", async () => {
    const demo = new DemoEngine();
    let asked = "";
    const req = {
      agent: { role: "planner", name: "Ada" },
      provider: { kind: "ollama", model: "m" },
      cwd: ".", system: "", mode: "read",
      prompt: "# Conversation\n## User\nread attachment budget.csv part 2\n",
      readAttachment: (name: string, part: number) => { asked = `${name}:${part}`; return "part 2 of 2\n\nrest"; },
      onActivity: () => {},
    } as unknown as EngineRequest;
    const reply = String((await demo.run(req)).output?.reply);
    expect(asked).toBe("budget.csv:2");
    expect(reply).toContain("part 2 of 2");
  });
});
