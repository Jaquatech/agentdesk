import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCapabilities, ollamaRoot } from "../src/providers/capabilities.ts";
import { loadForPrompt } from "../src/attachments.ts";

describe("model capabilities", () => {
  it("asks Ollama's native API and reads vision and tools", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(`${req.method} ${req.url} ${body}`);
        const model = JSON.parse(body).model;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ capabilities: model === "gemma3:4b" ? ["completion", "vision"] : ["completion", "tools", "thinking"] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
    expect(await getCapabilities("ollama", base, "qwen3:4b")).toMatchObject({ vision: false, tools: true });
    expect(await getCapabilities("ollama", base, "gemma3:4b")).toMatchObject({ vision: true, tools: false });
    expect(seen[0]).toContain("POST /api/show");
    server.close();
  });

  it("knows Claude, and says unknown for other providers or an unreachable Ollama", async () => {
    expect(await getCapabilities("anthropic", "", "claude-haiku-5-5")).toMatchObject({ vision: true, tools: true });
    expect(await getCapabilities("openai", "", "gpt-x")).toMatchObject({ vision: null, tools: null });
    expect(await getCapabilities("ollama", "http://127.0.0.1:9/v1", "m")).toMatchObject({ vision: null });
    expect(ollamaRoot("http://localhost:11434/v1/")).toBe("http://localhost:11434");
  });

  it("names images instead of sending them to a model without vision", () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-cap-"));
    const png = join(dir, "1-a.png");
    writeFileSync(png, Buffer.from([137, 80, 78, 71]));
    const rows = [{ id: 1, chat_id: 1, message_id: 1, name: "a.png", mime: "image/png", size: 4, path: png, created_at: "" }];
    const blind = loadForPrompt(rows, { vision: false, model: "qwen3:4b" });
    expect(blind.images).toHaveLength(0);
    expect(blind.skipped[0]).toContain("qwen3:4b cannot read images");
    expect(loadForPrompt(rows, { vision: null }).images).toHaveLength(1); // unknown: try
  });
});

describe("OpenAI-compatible request shape", () => {
  it("never sends a null message content (Ollama rejects it) and keeps the hidden thinking apart", async () => {
    const { OpenAICompatibleProvider } = await import("../src/providers/openai.ts");
    let sent: any;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        sent = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "<think>plan it</think>Done." } }], usage: {} }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const p = new OpenAICompatibleProvider(`http://127.0.0.1:${(server.address() as any).port}/v1`);
    const r = await p.chat({ model: "m", system: "s", messages: [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [] },
      { role: "user", content: [{ type: "text", text: "again" }] },
    ] });
    expect(sent.messages[2]).toEqual({ role: "assistant", content: "" });
    expect(r.content).toEqual([{ type: "text", text: "Done." }]);
    expect(r.thinking).toBe("plan it");
    server.close();
  });
});

describe("thinking off", () => {
  it("sends Ollama's think flag, /no_think for Qwen3 and low effort for gpt-oss; nothing extra by default", async () => {
    const { OpenAICompatibleProvider } = await import("../src/providers/openai.ts");
    const bodies: any[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        bodies.push(JSON.parse(body));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const p = new OpenAICompatibleProvider(`http://127.0.0.1:${(server.address() as any).port}/v1`);
    const ask = (model: string, thinking?: "off") => p.chat({ model, system: "sys", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], thinking });
    await ask("qwen3:4b", "off");
    await ask("qwen3-coder:30b", "off");
    await ask("gpt-oss:20b", "off");
    await ask("qwen3:4b");
    server.close();
    expect(bodies[0].think).toBe(false);
    expect(bodies[0].messages[0].content).toBe("sys\n\n/no_think");
    expect(bodies[1].messages[0].content).toBe("sys");
    expect(bodies[2].reasoning_effort).toBe("low");
    expect(bodies[3].think).toBeUndefined();
    expect(bodies[3].messages[0].content).toBe("sys");
  });
});
