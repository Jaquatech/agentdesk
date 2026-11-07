import type { Engine, EngineRequest, EngineResult, TranscriptEntry } from "./types.ts";
import { parseAllowedTools, READ_ONLY_TOOLS, DEFAULT_WORKER_TOOLS } from "./types.ts";
import { READ_TOOLS, WRITE_TOOLS, FINISH_TOOL, runTool } from "./tools.ts";
import type { ChatMessage, Block, ToolDef } from "../providers/types.ts";
import { textOf } from "../providers/types.ts";
import { callCost } from "../pricing.ts";

/**
 * Built-in agent loop for any API provider (Anthropic, OpenAI-compatible, Ollama).
 * The model only proposes tool calls; this loop checks and runs them inside the worktree.
 */
export class ApiLoopEngine implements Engine {
  async run(req: EngineRequest): Promise<EngineResult> {
    const t0 = Date.now();
    const chat = req.provider.chat;
    if (!chat) throw new Error(`Provider ${req.provider.name} is not an API provider`);
    const write = req.mode === "write";
    const allowedRaw = req.agent.allowed_tools && req.agent.allowed_tools !== "[]"
      ? req.agent.allowed_tools : JSON.stringify(write ? DEFAULT_WORKER_TOOLS : READ_ONLY_TOOLS);
    const { commandPrefixes } = parseAllowedTools(write ? allowedRaw : JSON.stringify(READ_ONLY_TOOLS));

    const finalTool: ToolDef = req.output ?? FINISH_TOOL;
    const tools = [...READ_TOOLS, ...(write ? WRITE_TOOLS : []), finalTool];
    const system = `${req.system}

# Tools
You work inside one folder; paths are relative to it. Use list_files, read_file and search to look around${write ? ", write_file and edit_file to change files" : ""}.
run_command accepts only commands that start with: ${commandPrefixes.join(", ") || "(none)"}. No pipes or redirects.
When you are done, call ${finalTool.name} exactly once. Do not ask questions; take the most reasonable reading and say so.`;

    const att = req.attachments;
    const attText = att && (att.texts.length || att.images.length || att.skipped.length)
      ? "\n\n# Attached by the user\n" +
        att.images.map((i) => `- ${i.name} (image, shown below)`).concat(att.skipped.map((s) => `- ${s}`)).join("\n") +
        att.texts.map((t) => `\n\n## ${t.name}\n\`\`\`\n${t.content}\n\`\`\``).join("")
      : "";
    const first: Block[] = [{ type: "text", text: req.prompt + attText }];
    for (const img of att?.images ?? []) first.push({ type: "image", mediaType: img.mime, data: img.base64 });
    const messages: ChatMessage[] = [{ role: "user", content: first }];
    const maxTurns = Math.max(1, req.agent.max_turns || 60);
    let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0, cost = 0, turns = 0, lastText = "";
    let changedFiles = 0, nudges = 0;
    const transcript: TranscriptEntry[] = [];
    const log = (e: Omit<TranscriptEntry, "t">) => {
      if (transcript.length >= 600) return;
      const entry = { t: Date.now() - t0, ...e, text: e.text?.slice(0, 20_000), output: e.output?.slice(0, 8_000) };
      transcript.push(entry);
      req.onStep?.(entry);
    };
    log({ kind: "instructions", text: system });
    log({ kind: "prompt", text: req.prompt + (req.attachments?.images.length ? `\n\n(+ ${req.attachments.images.length} image(s))` : "") });
    const price = req.provider.price;

    const done = (ok: boolean, summary: string, output?: Record<string, unknown>, error?: string): EngineResult => ({
      ok, summary, output, error, turns, tokensIn, tokensOut, cacheRead, cacheWrite, transcript,
      // Local providers (Ollama) cost nothing; an unpriced cloud model is "unknown", not zero.
      costUsd: price ? Math.round(cost * 1e6) / 1e6 : req.provider.kind === "ollama" ? 0 : null,
      seconds: Math.round((Date.now() - t0) / 1000),
    });

    try {
      while (turns < maxTurns) {
        if (req.signal?.aborted) return done(false, lastText, undefined, "Stopped");
        turns++;
        req.onActivity?.("thinking", `turn ${turns}`);
        const callStart = Date.now();
        const res = await chat.chat({
          model: req.provider.model, system, messages, tools, maxTokens: 8192, signal: req.signal,
          thinking: req.agent.thinking === "off" ? "off" : undefined,
          toolChoice: turns === maxTurns ? finalTool.name : undefined,
        });
        tokensIn += res.usage.input;
        cacheRead += res.usage.cacheRead;
        cacheWrite += res.usage.cacheWrite;
        tokensOut += res.usage.output;
        if (price) cost += callCost(price, res.usage); // priced per call: the long-prompt tier applies per request
        messages.push({ role: "assistant", content: res.content });
        const text = textOf(res.content);
        const callsMade = res.content.filter((b) => b.type === "tool_use").length;
        if (res.thinking) log({ kind: "thinking", text: res.thinking });
        log({ kind: "model", text: text || (callsMade ? "" : "(empty answer)"), ms: Date.now() - callStart,
          tokens: { in: res.usage.input + res.usage.cacheRead + res.usage.cacheWrite, out: res.usage.output, cacheRead: res.usage.cacheRead } });
        req.onLog?.(`turn ${turns}: ${((Date.now() - callStart) / 1000).toFixed(1)} s, ${res.usage.output} tokens out${callsMade ? `, ${callsMade} tool call(s)` : ", no tool call"}`);
        if (text) { lastText = text; req.onLog?.(text.slice(0, 500)); }

        const calls = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
        if (!calls.length && !text && res.stopReason === "max_tokens") {
          // The whole answer budget went to reasoning: nothing to show, and the next turn will likely do the same.
          log({ kind: "note", text: `Used the whole answer limit (${res.usage.output} tokens) on thinking and gave no answer.` +
            (req.agent.thinking === "off" ? "" : " Set Thinking to Off for this agent to get answers faster.") });
          req.onLog?.("⚠ used the whole answer limit on thinking");
        }
        if (!calls.length) {
          // Small models often paste the code into their answer instead of calling the tools. That changes nothing,
          // so a developer that has not written a file yet is told so (twice at most) rather than "finishing".
          if (write && !changedFiles && nudges < 2) {
            nudges++;
            req.onLog?.("↺ answered without changing any file; asked to use the file tools");
            log({ kind: "note", text: "Answered without changing any file: reminded to use write_file / edit_file." });
            messages.push({ role: "user", content: [{ type: "text", text:
              "Your answer was not applied: no file changed. Code in a chat reply does nothing here. " +
              "Use edit_file (exact old_text → new_text) or write_file (whole file) to make the changes, then call finish." }] });
            continue;
          }
          if (!req.output) return done(true, lastText || "(no summary)");
          messages.push({ role: "user", content: [{ type: "text", text: `Call ${finalTool.name} now with your result.` }] });
          continue;
        }
        const results: Block[] = [];
        for (const call of calls) {
          if (call.name === finalTool.name) {
            log({ kind: "tool", tool: call.name, input: call.input });
            const summary = String((call.input as any).summary ?? lastText ?? "");
            return done(true, summary, call.input);
          }
          const outcome = await runTool(call.name, call.input, {
            cwd: req.cwd, canWrite: write, commandPrefixes, signal: req.signal,
            // Only developers may ask; planners and reviewers stay read-only (their list is fixed).
            ask: req.askApproval && write ? async (command) => {
              req.onActivity?.("waiting", "needs your OK");
              log({ kind: "note", text: `Asked you to allow: ${command}` });
              const answer = await req.askApproval!({ kind: "command", command, cwd: req.cwd });
              log({ kind: "note", text: `${answer.allowed ? "Allowed" : "Denied"} by ${answer.by ?? "user"}: ${command}` });
              return answer;
            } : undefined,
          });
          if (!outcome.isError && (call.name === "write_file" || call.name === "edit_file")) changedFiles++;
          req.onActivity?.(outcome.activity, outcome.detail);
          req.onLog?.(`${outcome.isError ? "✗" : "→"} ${outcome.detail}`);
          log({ kind: "tool", tool: call.name, input: call.input, output: outcome.content, isError: outcome.isError });
          results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content.slice(0, 60_000), is_error: outcome.isError });
        }
        messages.push({ role: "user", content: results });
      }
      return done(false, lastText, undefined, `Stopped after ${maxTurns} turns without finishing`);
    } catch (err) {
      log({ kind: "error", text: String((err as Error).message ?? err) });
      return done(false, lastText, undefined, String((err as Error).message ?? err));
    }
  }
}
