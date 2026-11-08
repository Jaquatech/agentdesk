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
    expect(g.record("edit_file", call, true).action).toBe("ok");
    expect(g.record("edit_file", { new_text: "y", old_text: "x", path: "a.html" }, true).action).toBe("ok"); // key order does not matter
    expect(g.record("edit_file", call, true)).toEqual({ action: "warn", repeats: 3 });
    expect(g.record("edit_file", call, true)).toEqual({ action: "warn", repeats: 4 });
    const stop = g.record("edit_file", call, true);
    expect(stop.action).toBe("stop");
    expect((stop as any).reason).toContain("edit_file");
  });

  it("resets on a call that works or on a different call", () => {
    const g = new LoopGuard();
    for (let i = 0; i < 2; i++) g.record("edit_file", { n: 1 }, true);
    expect(g.record("read_file", { path: "a" }, false).action).toBe("ok");
    expect(g.record("edit_file", { n: 1 }, true).action).toBe("ok");
    g.record("edit_file", { n: 1 }, true);
    expect(g.record("edit_file", { n: 2 }, true).action).toBe("ok"); // different input: a new streak of repeats
  });

  it("stops after many failures in a row even when the input changes", () => {
    const g = new LoopGuard();
    let last: any;
    for (let i = 0; i < 12; i++) last = g.record("edit_file", { n: i }, true);
    expect(last.action).toBe("stop");
    expect(last.reason).toContain("12");
  });

  it("tells the model what to do instead", () => {
    expect(loopWarning("edit_file", 3)).toContain("read_file");
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
        return { content: [{ type: "tool_use", id: String(requests.length), name: "edit_file",
          input: { path: "team.html", old_text: "    </div>", new_text: "    <p>new</p>" } }], stopReason: "tool_use", usage };
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
    expect(r.turns).toBe(5); // not 60
    const lastResult = requests.at(-1)!.messages.at(-1)!.content[0] as any;
    expect(lastResult.content).toContain("Do not send it again");
  });
});
