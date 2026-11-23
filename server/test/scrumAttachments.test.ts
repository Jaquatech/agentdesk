import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import { attachmentPrompt } from "../src/attachments.ts";
import { claudeAttachmentPrompt } from "../src/engines/claudeCli.ts";
import { DemoEngine } from "../src/engines/demo.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const ok = (summary: string, output?: Record<string, unknown>): EngineResult =>
  ({ ok: true, summary, output, turns: 1, costUsd: 0.01, tokensIn: 100, cacheRead: 0, cacheWrite: 0, tokensOut: 10, seconds: 0 });

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-scrum-att-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

async function waitFor<T>(fn: () => T | undefined, ms = 20000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe("demo scrum chat quotes attachments", () => {
  it("mentions an attached file's name and uses its text", async () => {
    const demo = new DemoEngine();
    const req = {
      output: { name: "submit_backlog", description: "", input_schema: {} },
      prompt: "# Conversation\n## Business owner\nAdd a dust alarm\n\n# Scrum state\nempty\n",
      attachments: {
        images: [], texts: [{ name: "spec.txt", content: "The dust alarm threshold is 12." }],
        skipped: ["brief.pdf (application/pdf, 1 KB: not sent to the model)"], paths: [], readPaths: [], notes: [],
      },
      onActivity: () => {},
      agent: { role: "planner", name: "Nova" },
      provider: { kind: "ollama", model: "m" },
      cwd: ".", system: "", mode: "read",
    } as unknown as EngineRequest;
    const reply = String((await demo.run(req)).output?.reply);
    expect(reply).toContain("spec.txt");
    expect(reply).toContain("dust alarm threshold is 12");
    expect(reply).toContain("brief.pdf");
    expect(reply).toContain("not sent");
  });
});

describe("scrum chat attachments", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let cookie: string;
  const backlog: EngineRequest[] = [];
  const arch: { prompt: string; attachments: EngineRequest["attachments"] }[] = [];

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-"));
    repo = gitRepo();
    backlog.length = 0;
    arch.length = 0;
    engineOverride.engine = { run: async (req) => {
      if (req.output?.name === "submit_backlog") {
        backlog.push(req);
        const second = req.prompt.includes("second request");
        return ok("b", { reply: "Added.", items: [{ title: second ? "Second item" : "From the file", story: "As an owner I want it", acceptance: "- [ ] done" }] });
      }
      if (req.output?.name === "submit_architecture") {
        arch.push({ prompt: req.prompt, attachments: req.attachments });
        return ok("a", { tech_notes: "Write src/.", paths: ["src/"] });
      }
      if (req.output?.name === "submit_estimate") return ok("e", { points: 2, reason: "small" });
      throw new Error("unexpected " + (req.output?.name ?? req.agent.role));
    } };
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => (await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    for (const [name, role] of [["Ada", "planner"], ["Bo", "worker"], ["Cy", "reviewer"]]) await call("POST", "/api/agents", { name, role, provider_id: prov.id });
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    const working = (ctx.orch.scrum as any).working as Set<string>;
    for (let i = 0; i < 100 && working.size; i++) await new Promise((r) => setTimeout(r, 30));
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

  it("gives the product manager the text of the latest file, names earlier files, and records names on the item", async () => {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    await call("PUT", `/api/projects/${project.id}/scrum/settings`, { process: "scrum" });
    const chat = await call("POST", "/api/chats", { project_id: project.id });
    const old = await upload(chat.id, "old.txt", "text/plain", Buffer.from("obsolete secret"));
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "first request", attachment_ids: [old.id] });
    await waitFor(() => backlog.length === 1 && !ctx.orch.isPlanning(chat.id) ? true : undefined);

    const txt = await upload(chat.id, "notes.txt", "text/plain", Buffer.from("purple hedgehog"));
    const pdf = await upload(chat.id, "report.pdf", "application/pdf", Buffer.from("%PDF-1.1 not really"));
    await call("POST", `/api/chats/${chat.id}/messages`, { content: "second request", attachment_ids: [txt.id, pdf.id] });
    const req = await waitFor(() => backlog.length >= 2 ? backlog[1] : undefined);

    expect(req.attachments?.texts.map((t) => t.content).join("\n")).toContain("purple hedgehog");
    expect(req.attachments?.texts.map((t) => t.content).join("\n")).not.toContain("obsolete secret");
    expect(req.prompt).toContain("attached earlier: old.txt");
    expect(req.prompt).not.toContain("obsolete secret");
    expect(req.prompt).not.toContain("purple hedgehog");
    const shown = attachmentPrompt(req.attachments!);
    expect(shown).toContain("purple hedgehog");
    expect(shown).toContain("notes.txt");
    expect(shown).toContain("report.pdf");
    expect(shown).toContain("not sent to the model");
    expect(shown).toContain("Do not guess");
    expect(req.attachments?.images).toEqual([]);
    const cli = claudeAttachmentPrompt(req.attachments);
    expect(cli).toContain("notes.txt");
    expect(cli).toContain("Read these");
    expect(cli).toContain("report.pdf");
    expect(cli).toContain("Do not guess");
    // The PDF is named with the reason. It is not in the list of files to open.
    expect(cli.split("- report.pdf")[0]).not.toContain("report.pdf");

    const view = await call("GET", `/api/chats/${chat.id}`);
    const message = view.messages.filter((m: { role: string }) => m.role === "user").at(-1);
    expect(message.attachments.find((a: { name: string }) => a.name === "notes.txt").note).toBe("");
    expect(message.attachments.find((a: { name: string }) => a.name === "report.pdf").note).toBe("report.pdf not sent: PDF files are named only");

    const item = ctx.db.prepare("SELECT request FROM backlog_items WHERE title = ?").get("Second item") as { request: string };
    expect(item.request).toContain("notes.txt");
    expect(item.request).toContain("report.pdf");
    expect(item.request).not.toContain("purple hedgehog");
    const seen = await waitFor(() => arch.find((a) => a.prompt.includes("notes.txt")));
    expect(seen.prompt).toContain("report.pdf");
    expect(seen.prompt).not.toContain("purple hedgehog");
    expect(seen.attachments).toBeUndefined();
  });

  it("names an image and the reason when the product manager's model cannot read images", async () => {
    const server = createServer((req, res) => {
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      const local = await call("POST", "/api/providers", { name: "Local", kind: "ollama", base_url: `http://127.0.0.1:${port}/v1`, default_model: "blind-model" });
      ctx.db.prepare("UPDATE agents SET provider_id = ?, model = ? WHERE name = 'Ada'").run(local.id, "blind-model");
      const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
      await call("PUT", `/api/projects/${project.id}/scrum/settings`, { process: "scrum" });
      const chat = await call("POST", "/api/chats", { project_id: project.id });
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      const img = await upload(chat.id, "screen.png", "image/png", png);
      const seen: EngineRequest[] = [];
      engineOverride.engine = { run: async (req) => {
        seen.push(req);
        if (req.output?.name === "submit_backlog") return ok("b", { reply: "I cannot see the image.", items: [] });
        if (req.output?.name === "submit_estimate") return ok("e", { points: 2, reason: "small" });
        return ok("a", { tech_notes: "n", paths: ["src/"] });
      } };
      await call("POST", `/api/chats/${chat.id}/messages`, { content: "What is in this screenshot?", attachment_ids: [img.id] });
      const req = await waitFor(() => seen.find((r) => r.output?.name === "submit_backlog"));
      expect(req.attachments?.images).toEqual([]);
      expect(req.attachments?.skipped.join("\n")).toContain("screen.png");
      expect(req.attachments?.skipped.join("\n")).toContain("blind-model cannot read images");
      const shown = `${req.prompt}\n${attachmentPrompt(req.attachments!)}`;
      expect(shown).toContain("screen.png");
      expect(shown).toContain("cannot read images");
      expect(shown).not.toContain(png.toString("base64"));
      const cli = claudeAttachmentPrompt(req.attachments);
      expect(cli).toContain("# Attached by the user");
      expect(cli).toContain("screen.png");
      expect(cli).toContain("cannot read images");
      expect(cli).not.toContain("Read these");
      const view = await call("GET", `/api/chats/${chat.id}`);
      const message = view.messages.find((m: { role: string }) => m.role === "user");
      expect(message.attachments[0].note).toBe("PNG not sent: this model cannot read images");
    } finally { server.close(); }
  });
});
