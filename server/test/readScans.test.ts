import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildApp } from "../src/index.ts";
import { engineOverride } from "../src/providers/index.ts";
import type { EngineRequest, EngineResult } from "../src/engines/types.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "attachments");

const ok = (summary: string): EngineResult =>
  ({ ok: true, summary, turns: 1, costUsd: 0.01, tokensIn: 100, cacheRead: 0, cacheWrite: 0, tokensOut: 10, seconds: 0 });

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ad-scan-repo-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

describe("reading scanned PDFs at upload", () => {
  let data: string, repo: string, ctx: Awaited<ReturnType<typeof buildApp>>;
  let call: (method: string, url: string, payload?: unknown) => Promise<any>;
  let cookie: string;
  let seen: EngineRequest[];
  let reply: EngineResult;
  let agentId = 0;

  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-data-scan-"));
    repo = gitRepo();
    seen = [];
    reply = ok("## Page 1\n\nInvoice 4711");
    engineOverride.engine = { run: async (req) => {
      seen.push(req);
      if (req.prompt.startsWith("Transcribe")) return reply;
      throw new Error("unexpected " + (req.output?.name ?? req.agent.role));
    } };
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
    call = async (method, url, payload) => (await ctx.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, host: "localhost" } })).json();
    const secret = await call("POST", "/api/secrets", { name: "key", value: "sk-test-1234567890" });
    const prov = await call("POST", "/api/providers", { name: "Anthropic", kind: "anthropic", secret_id: secret.id, default_model: "m" });
    const agent = await call("POST", "/api/agents", { name: "Reader", role: "worker", provider_id: prov.id });
    agentId = agent.id;
  });

  afterEach(async () => {
    engineOverride.engine = undefined;
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function chat() {
    const project = await call("POST", "/api/projects", { name: "demo", source: "local", path: repo });
    return call("POST", "/api/chats", { project_id: project.id });
  }

  async function upload(chatId: number, name: string, type: string, body: Buffer) {
    return (await ctx.app.inject({
      method: "POST", url: `/api/chats/${chatId}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      headers: { cookie, host: "localhost", "content-type": "application/octet-stream" }, payload: body,
    })).json();
  }

  const scanBytes = () => readFileSync(join(FIXTURES, "scan.pdf"));
  const transcribeCalls = () => seen.filter((r) => r.prompt.startsWith("Transcribe"));

  it("leaves a scan as needs_ocr and calls no agent when no reader is chosen", async () => {
    const c = await chat();
    const up = await upload(c.id, "scan.pdf", "application/pdf", scanBytes());
    expect(up.status).toBe("needs_ocr");
    expect(transcribeCalls()).toHaveLength(0);
  });

  it("reads a scan with the chosen agent and keeps the transcription as the copy", async () => {
    await call("PUT", "/api/settings", { scan_reader_agent_id: agentId });
    const c = await chat();
    const up = await upload(c.id, "scan.pdf", "application/pdf", scanBytes());
    expect(up.status).toBe("converted");
    expect(transcribeCalls()).toHaveLength(1);
    const req = transcribeCalls()[0];
    expect(req.attachments?.images).toHaveLength(1);
    expect(req.attachments?.images[0].mime).toBe("image/png");
    expect(req.attachments?.images[0].name).toBe("scan.pdf page 1");
    const copy = readFileSync(join(data, "attachments", String(c.id), `${up.id}.md`), "utf8");
    expect(copy).toContain("Invoice 4711");
  });

  it("records a failure when the reader's call fails", async () => {
    await call("PUT", "/api/settings", { scan_reader_agent_id: agentId });
    reply = { ...ok(""), ok: false, error: "model overloaded" };
    const c = await chat();
    const up = await upload(c.id, "scan.pdf", "application/pdf", scanBytes());
    expect(up.status.startsWith("failed:")).toBe(true);
    expect(transcribeCalls()).toHaveLength(1);
  });

  it("never sends a PDF that has a text layer to the reader", async () => {
    await call("PUT", "/api/settings", { scan_reader_agent_id: agentId });
    const c = await chat();
    const up = await upload(c.id, "sample.pdf", "application/pdf", readFileSync(join(FIXTURES, "sample.pdf")));
    expect(up.status).toBe("converted");
    expect(transcribeCalls()).toHaveLength(0);
  });
});
