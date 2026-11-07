import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiLoopEngine } from "../src/engines/apiLoop.ts";
import type { ChatProvider, ChatRequest, ChatResponse } from "../src/providers/types.ts";
import type { AgentRow } from "../src/engines/types.ts";
import { REVIEW_TOOL } from "../src/orchestrator/prompts.ts";

const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };

function scripted(turns: ((req: ChatRequest) => ChatResponse)[]): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    async chat(req) { requests.push(JSON.parse(JSON.stringify(req))); return turns[requests.length - 1](req); },
    async listModels() { return []; },
  };
}

const agent = (role: AgentRow["role"], tools: string[] = []): AgentRow => ({
  id: 1, name: "T", role, provider_id: 1, model: "m", context: "", max_turns: 5, timeout_min: 5,
  allowed_tools: JSON.stringify(tools), appearance: "{}", enabled: 1,
});

describe("built-in agent loop", () => {
  it("runs tool calls in the folder and finishes with a summary and cost", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-loop-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    const chat = scripted([
      () => ({ content: [{ type: "tool_use", id: "1", name: "read_file", input: { path: "a.txt" } }], stopReason: "tool_use", usage }),
      () => ({ content: [{ type: "tool_use", id: "2", name: "write_file", input: { path: "b.txt", content: "world" } },
        { type: "tool_use", id: "3", name: "run_command", input: { command: "rm -rf ." } }], stopReason: "tool_use", usage }),
      () => ({ content: [{ type: "tool_use", id: "4", name: "finish", input: { summary: "Wrote b.txt" } }], stopReason: "tool_use", usage }),
    ]);
    const r = await new ApiLoopEngine().run({
      agent: agent("worker", ["Read", "Bash(git status:*)"]), cwd: dir, system: "sys", prompt: "do it", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "anthropic", model: "m", chat,
        price: { model: "m", price_in: 2, price_out: 10, cache_read: 0.2, cache_write: 2.5, long_threshold: 0, long_multiplier: 1, note: "" } },
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe("Wrote b.txt");
    expect(readFileSync(join(dir, "b.txt"), "utf8")).toBe("world");
    expect(r.turns).toBe(3);
    expect(r.costUsd).toBeCloseTo(3 * (1000 * 2 + 100 * 10) / 1e6, 6);
    // the file content came back as a tool result, the blocked command as an error
    const second = chat.requests[1].messages.at(-1)!.content[0] as any;
    expect(second.content).toContain("1\thello");
    const third = chat.requests[2].messages.at(-1)!.content as any[];
    expect(third[1].is_error).toBe(true);
    expect(third[1].content).toContain("not allowed");
  });

  it("read mode has no write tools and returns structured output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-loop-"));
    const chat = scripted([
      (req) => {
        expect(req.tools!.map((t) => t.name)).not.toContain("write_file");
        return { content: [{ type: "tool_use", id: "1", name: "submit_review", input: { verdict: "approve", review: "ok" } }], stopReason: "tool_use", usage };
      },
    ]);
    const r = await new ApiLoopEngine().run({
      agent: agent("reviewer"), cwd: dir, system: "s", prompt: "p", mode: "read", output: REVIEW_TOOL,
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat },
    });
    expect(r.output).toEqual({ verdict: "approve", review: "ok" });
    expect(r.costUsd).toBe(0); // local model: free, not unknown
  });

  it("forces the final tool on the last turn", async () => {
    const chat = scripted(Array(5).fill(0).map((_, i) => (req: ChatRequest) => i < 4
      ? { content: [{ type: "tool_use", id: String(i), name: "list_files", input: {} }], stopReason: "tool_use", usage }
      : (expect(req.toolChoice).toBe("finish"), { content: [{ type: "tool_use", id: "x", name: "finish", input: { summary: "done" } }], stopReason: "tool_use", usage })));
    const r = await new ApiLoopEngine().run({
      agent: agent("worker"), cwd: mkdtempSync(join(tmpdir(), "ad-loop-")), system: "s", prompt: "p", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "openai", model: "m", chat },
    });
    expect(r.ok).toBe(true);
    expect(r.turns).toBe(5);
    expect(r.costUsd).toBeNull(); // cloud model without a price: unknown
  });
});

describe("pricing", () => {
  it("prices per call and applies the long-prompt tier per request", async () => {
    const { callCost } = await import("../src/pricing.ts");
    const haiku = { model: "h", price_in: 0.1, price_out: 0.5, cache_read: 0.01, cache_write: 0.125, long_threshold: 100_000, long_multiplier: 5, note: "" };
    const small = callCost(haiku, { input: 10_000, cacheRead: 80_000, cacheWrite: 0, output: 1_000 });
    expect(small).toBeCloseTo((10_000 * 0.1 + 80_000 * 0.01 + 1_000 * 0.5) / 1e6, 9);
    const big = callCost(haiku, { input: 10_000, cacheRead: 95_000, cacheWrite: 0, output: 1_000 });
    expect(big).toBeCloseTo(5 * (10_000 * 0.1 + 95_000 * 0.01 + 1_000 * 0.5) / 1e6, 9);
  });
});

describe("small-model guard", () => {
  it("asks a developer that answers with pasted code to use the file tools", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-loop-"));
    const chat = scripted([
      () => ({ content: [{ type: "text", text: "Here is the code:\n```html\n<h1>x</h1>\n```" }], stopReason: "end", usage }),
      (req) => {
        const last = req.messages.at(-1)!.content[0] as any;
        expect(last.text).toContain("not applied");
        return { content: [{ type: "tool_use", id: "1", name: "write_file", input: { path: "index.html", content: "<h1>x</h1>" } }], stopReason: "tool_use", usage };
      },
      () => ({ content: [{ type: "text", text: "Done: wrote index.html" }], stopReason: "end", usage }),
    ]);
    const r = await new ApiLoopEngine().run({
      agent: agent("worker"), cwd: dir, system: "s", prompt: "p", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat },
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("<h1>x</h1>");
    expect(r.summary).toBe("Done: wrote index.html");
  });

  it("gives up after two reminders", async () => {
    const say = () => ({ content: [{ type: "text" as const, text: "code in chat" }], stopReason: "end" as const, usage });
    const chat = scripted([say, say, say]);
    const r = await new ApiLoopEngine().run({
      agent: agent("worker"), cwd: mkdtempSync(join(tmpdir(), "ad-loop-")), system: "s", prompt: "p", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat },
    });
    expect(r.turns).toBe(3);
    expect(chat.requests).toHaveLength(3);
  });
});

describe("asking before a command", () => {
  const callCmd = (command: string) => () => ({ content: [{ type: "tool_use" as const, id: "1", name: "run_command", input: { command } }], stopReason: "tool_use" as const, usage });
  const finish = () => ({ content: [{ type: "tool_use" as const, id: "2", name: "finish", input: { summary: "ok" } }], stopReason: "tool_use" as const, usage });

  it("runs a command outside the list once the user allows it", async () => {
    const chat = scripted([callCmd("echo approved-run"), finish]);
    const asked: string[] = [];
    const r = await new ApiLoopEngine().run({
      agent: agent("worker", ["Read"]), cwd: mkdtempSync(join(tmpdir(), "ad-ask-")), system: "s", prompt: "p", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat },
      askApproval: async (q) => { asked.push(q.command); return { allowed: true, by: "jan" }; },
    });
    expect(asked).toEqual(["echo approved-run"]);
    const result = (chat.requests[1].messages.at(-1)!.content[0] as any).content;
    expect(result).toContain("approved-run");
    expect(r.transcript!.filter((e) => e.kind === "note").map((e) => e.text)).toEqual(["Asked you to allow: echo approved-run", "Allowed by jan: echo approved-run"]);
  });

  it("tells the model when the user says no", async () => {
    const chat = scripted([callCmd("rm -rf build"), finish]);
    await new ApiLoopEngine().run({
      agent: agent("worker", ["Read"]), cwd: mkdtempSync(join(tmpdir(), "ad-ask-")), system: "s", prompt: "p", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat },
      askApproval: async () => ({ allowed: false, by: "jan" }),
    });
    const result = chat.requests[1].messages.at(-1)!.content[0] as any;
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("did not allow");
  });
});

describe("read-only agents", () => {
  it("never ask: a reviewer's command outside its list is refused", async () => {
    const chat = scripted([
      () => ({ content: [{ type: "tool_use" as const, id: "1", name: "run_command", input: { command: "npm install x" } }], stopReason: "tool_use" as const, usage }),
      () => ({ content: [{ type: "tool_use" as const, id: "2", name: "submit_review", input: { verdict: "approve", review: "ok" } }], stopReason: "tool_use" as const, usage }),
    ]);
    let asked = false;
    await new ApiLoopEngine().run({
      agent: agent("reviewer"), cwd: mkdtempSync(join(tmpdir(), "ad-ro-")), system: "s", prompt: "p", mode: "read", output: REVIEW_TOOL,
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat },
      askApproval: async () => { asked = true; return { allowed: true }; },
    });
    expect(asked).toBe(false);
    expect((chat.requests[1].messages.at(-1)!.content[0] as any).content).toContain("Command not allowed");
  });
});
