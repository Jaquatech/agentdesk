import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LoopGuard, loopWarning } from "../src/engines/loopGuard.ts";
import { ApiLoopEngine } from "../src/engines/apiLoop.ts";
import type { ChatProvider, ChatRequest, ChatResponse } from "../src/providers/types.ts";
import type { AgentRow } from "../src/engines/types.ts";

const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };

describe("loop guard", () => {
  it("warns on the 3rd identical failure and stops on the 5th", () => {
    const g = new LoopGuard();
    const call = { path: "a.html", old_text: "x", new_text: "y" };
    expect(g.record("run_command", { command: "npm test" }, true).action).toBe("ok");
    expect(g.record("run_command", { command: "npm test" }, true).action).toBe("ok");
    expect(g.record("run_command", { command: "npm test" }, true)).toEqual({ action: "warn", repeats: 3 });
    expect(g.record("run_command", { command: "npm test" }, true)).toEqual({ action: "warn", repeats: 4 });
    const stop = g.record("run_command", { command: "npm test" }, true);
    expect(stop.action).toBe("stop");
    expect((stop as any).reason).toContain("run_command");
    // key order does not matter
    const h = new LoopGuard();
    h.record("edit_file", call, true);
    h.record("edit_file", { new_text: "y", old_text: "x", path: "a.html" }, true);
    expect(h.record("edit_file", call, true)).toEqual({ action: "warn", repeats: 3 });
  });

  it("is not reset by reads in between: read, failed edit, read, failed edit...", () => {
    const g = new LoopGuard();
    const verdicts: string[] = [];
    for (let i = 0; i < 6; i++) {
      expect(g.record("read_file", { path: "team.html" }, false).action).toBe("ok");
      verdicts.push(g.record("edit_file", { path: "team.html", old_text: `try ${i}` }, true).action); // different text each time
    }
    expect(verdicts).toEqual(["ok", "ok", "warn", "warn", "warn", "stop"]);
  });

  it("is reset by a working call of the same tool", () => {
    const g = new LoopGuard();
    g.record("edit_file", { n: 1 }, true);
    g.record("edit_file", { n: 2 }, true);
    expect(g.record("edit_file", { n: 3 }, false).action).toBe("ok");
    expect(g.record("edit_file", { n: 4 }, true).action).toBe("ok");
    expect(g.record("edit_file", { n: 5 }, true).action).toBe("ok");
    expect(g.record("edit_file", { n: 6 }, true).action).toBe("warn");
  });

  it("does not stop a command that fails with different input, such as tests during debugging", () => {
    const g = new LoopGuard();
    for (let i = 0; i < 20; i++) expect(g.record("run_command", { command: `npm test -- case${i}` }, true).action).toBe("ok");
  });

  it("tells the model what to do instead", () => {
    expect(loopWarning("edit_file", 3)).toContain("write_file");
    expect(loopWarning("run_command", 3)).toContain("different tool");
  });
});

describe("agent loop with a repeating model", () => {
  it("adds the warning, then stops the run instead of using all turns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-loop-"));
    writeFileSync(join(dir, "team.html"), "<div>\n  <p>x</p>\n</div>\n");
    const requests: ChatRequest[] = [];
    const chat: ChatProvider = {
      async chat(req): Promise<ChatResponse> {
        requests.push(JSON.parse(JSON.stringify(req)));
        const n = requests.length;
        // Read the file, try an edit that never matches (the text changes a little each time), read again, ...
        const call = n % 2 === 1
          ? { name: "read_file", input: { path: "team.html" } }
          : { name: "edit_file", input: { path: "team.html", old_text: `    </div>${" ".repeat(n)}`, new_text: "    <p>new</p>" } };
        return { content: [{ type: "tool_use", id: String(n), ...call }], stopReason: "tool_use", usage };
      },
      async listModels() { return []; },
    };
    const agent: AgentRow = { id: 1, name: "T", role: "worker", provider_id: 1, model: "m", context: "", max_turns: 60, timeout_min: 5,
      allowed_tools: JSON.stringify([]), appearance: "{}", enabled: 1 };
    const r = await new ApiLoopEngine().run({ agent, cwd: dir, system: "sys", prompt: "do it", mode: "write",
      provider: { id: 1, name: "p", baseUrl: "", kind: "ollama", model: "m", chat } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Stopped");
    expect(r.error).toContain("edit_file");
    expect(r.turns).toBe(12); // 6 failed edits with a read before each, not 60
    const lastResult = requests.at(-1)!.messages.at(-1)!.content[0] as any;
    const warned = requests.slice(-3).some((q) => JSON.stringify(q.messages).includes("Do not send it again as it is"));
    expect(warned).toBe(true);
    expect(lastResult).toBeDefined();
  });
});
