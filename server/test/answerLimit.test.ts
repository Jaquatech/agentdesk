import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/index.ts";
import { parseMaxAnswerTokens, emptyAnswerNote, DEFAULT_MAX_ANSWER_TOKENS } from "../src/answerLimit.ts";
import { lowerOutputCap, outputCapFromError, FALLBACK_OUTPUT_CAP } from "../src/providers/outputCap.ts";
import { AnthropicProvider } from "../src/providers/anthropic.ts";
import { OpenAICompatibleProvider } from "../src/providers/openai.ts";
import type { ChatRequest } from "../src/providers/types.ts";

const hi: ChatRequest["messages"] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];

describe("max answer tokens default", () => {
  it("fills 32000 for a row inserted without the column, the same default the migration gives existing rows", () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), "ad-cap-")), "t.db"));
    db.prepare("INSERT INTO agents (name, role) VALUES ('Old', 'worker')").run();
    expect(db.prepare("SELECT max_answer_tokens AS n FROM agents").get()).toEqual({ n: DEFAULT_MAX_ANSWER_TOKENS });
    db.close();
  });

  it("stores the default when the API field is left out, and rejects a value outside the range", async () => {
    const ctx = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-cap-api-")) });
    try {
      const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
      const cookie = String(setup.headers["set-cookie"]).split(";")[0];
      const call = async (method: string, url: string, payload?: unknown) => {
        const r = await ctx.app.inject({ method: method as "GET", url, payload: payload as object, headers: { cookie, host: "localhost" } });
        return { status: r.statusCode, body: r.json() as { id?: number; error?: string; max_answer_tokens?: number; name?: string }[] | { id?: number; error?: string } };
      };
      const created = await call("POST", "/api/agents", { name: "Ada", role: "worker" });
      expect(created.status).toBe(200);
      const list = await call("GET", "/api/agents");
      const ada = (list.body as { name: string; max_answer_tokens: number }[]).find((a) => a.name === "Ada");
      expect(ada?.max_answer_tokens).toBe(32_000);

      const low = await call("POST", "/api/agents", { name: "Low", role: "worker", max_answer_tokens: 500 });
      expect(low.status).toBe(400);
      expect((low.body as { error: string }).error).toMatch(/1024/);
      const high = await call("POST", "/api/agents", { name: "High", role: "worker", max_answer_tokens: 128_001 });
      expect(high.status).toBe(400);
      const fraction = await call("POST", "/api/agents", { name: "Frac", role: "worker", max_answer_tokens: 4096.5 });
      expect(fraction.status).toBe(400);

      const set = await call("PUT", `/api/agents/${(created.body as { id: number }).id}`, { name: "Ada", role: "worker", max_answer_tokens: 4096 });
      expect(set.status).toBe(200);
      const again = await call("GET", "/api/agents");
      expect((again.body as { name: string; max_answer_tokens: number }[]).find((a) => a.name === "Ada")?.max_answer_tokens).toBe(4096);
    } finally {
      await ctx.app.close();
    }
  });
});

describe("parse and the empty-answer note", () => {
  it("accepts a whole number in range and treats a blank as the default", () => {
    expect(parseMaxAnswerTokens(undefined)).toEqual({ ok: true, value: 32_000 });
    expect(parseMaxAnswerTokens("")).toEqual({ ok: true, value: 32_000 });
    expect(parseMaxAnswerTokens(" 16000 ")).toEqual({ ok: true, value: 16_000 });
    expect(parseMaxAnswerTokens(1024).ok).toBe(true);
    expect(parseMaxAnswerTokens(128_000).ok).toBe(true);
    expect(parseMaxAnswerTokens(1023).ok).toBe(false);
    expect(parseMaxAnswerTokens(0).ok).toBe(false);
    expect(parseMaxAnswerTokens("nope").ok).toBe(false);
  });

  it("names the agent's limit, and the model's cap when that is lower", () => {
    expect(emptyAnswerNote(32_000, 32_000, false)).toBe(
      "Used the whole answer limit (32000 tokens) on thinking and gave no answer. Raise Max answer tokens for this agent, or set Thinking to Off to get answers faster.",
    );
    expect(emptyAnswerNote(32_000, 32_000, true)).not.toContain("Thinking");
    expect(emptyAnswerNote(32_000, 8192, false)).toContain("the model only accepted 8192");
    expect(emptyAnswerNote(32_000, 8192, false)).toContain("Max answer tokens is 32000");
  });
});

describe("a model that rejects a higher output cap", () => {
  it("reads the cap out of Anthropic and OpenAI errors", () => {
    expect(outputCapFromError("Anthropic 400 invalid_request_error: max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku")).toBe(8192);
    expect(outputCapFromError("400 invalid_request_error: max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000.")).toBe(16384);
    expect(outputCapFromError("Invalid 'max_tokens': integer above maximum value. Expected a value <= 4096, but got 32000 instead.")).toBe(4096);
    expect(outputCapFromError("model not found")).toBeNull();
    expect(lowerOutputCap(400, "max_tokens is too large", 32_000)).toBe(FALLBACK_OUTPUT_CAP);
    expect(lowerOutputCap(400, "model not found", 32_000)).toBeNull();
    expect(lowerOutputCap(401, "max_tokens is too large: at most 100 completion tokens", 32_000)).toBeNull();
  });

  async function serve(reply: (sent: number, n: number) => { status: number; body: unknown }) {
    const seen: number[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const sent = JSON.parse(raw).max_tokens as number;
        seen.push(sent);
        const out = reply(sent, seen.length);
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    return { seen, port, close: () => server.close() };
  }

  it("retries OpenAI with the cap the model names", async () => {
    const srv = await serve((sent) => sent > 4096
      ? { status: 400, body: { error: { message: "max_tokens is too large: 32000. This model supports at most 4096 completion tokens", type: "invalid_request_error" } } }
      : { status: 200, body: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { completion_tokens: 2 } } });
    try {
      const r = await new OpenAICompatibleProvider(`http://127.0.0.1:${srv.port}/v1`).chat({ model: "m", system: "s", messages: hi, maxTokens: 32_000 });
      expect(srv.seen).toEqual([32_000, 4096]);
      expect(r.maxTokens).toBe(4096);
      expect(r.content).toEqual([{ type: "text", text: "ok" }]);
    } finally { srv.close(); }
  });

  it("retries Anthropic, then steps down again when 8192 is still too high", async () => {
    const srv = await serve((sent) => {
      if (sent > 8192) return { status: 400, body: { error: { type: "invalid_request_error", message: "max_tokens is too large" } } };
      if (sent > 4096) return { status: 400, body: { error: { type: "invalid_request_error", message: "max_tokens: 8192 > 4096, which is the maximum allowed number of output tokens" } } };
      return { status: 200, body: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { output_tokens: 2 } } };
    });
    try {
      const r = await new AnthropicProvider(`http://127.0.0.1:${srv.port}`, "k").chat({ model: "m", system: "s", messages: hi, maxTokens: 32_000 });
      expect(srv.seen).toEqual([32_000, FALLBACK_OUTPUT_CAP, 4096]);
      expect(r.maxTokens).toBe(4096);
      expect(r.content).toEqual([{ type: "text", text: "ok" }]);
    } finally { srv.close(); }
  });

  it("does not retry an error that is not about the output cap", async () => {
    const srv = await serve(() => ({ status: 400, body: { error: { message: "model not found", type: "invalid_request_error" } } }));
    try {
      await expect(new OpenAICompatibleProvider(`http://127.0.0.1:${srv.port}/v1`).chat({ model: "missing", system: "s", messages: hi, maxTokens: 32_000 }))
        .rejects.toThrow(/model not found/);
      expect(srv.seen).toEqual([32_000]);
    } finally { srv.close(); }
  });

  it("sends the default cap when the caller does not set one", async () => {
    const srv = await serve(() => ({ status: 200, body: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} } }));
    try {
      const r = await new OpenAICompatibleProvider(`http://127.0.0.1:${srv.port}/v1`).chat({ model: "m", system: "s", messages: hi });
      expect(srv.seen).toEqual([DEFAULT_MAX_ANSWER_TOKENS]);
      expect(r.maxTokens).toBe(DEFAULT_MAX_ANSWER_TOKENS);
    } finally { srv.close(); }
  });
});
