import type { Engine, EngineRequest, EngineResult, TranscriptEntry } from "./types.ts";
import { parseAllowedTools, DEFAULT_WORKER_TOOLS, READ_ONLY_TOOLS } from "./types.ts";
import { runProgram, tail } from "../orchestrator/shell.ts";
import { dirname } from "node:path";
import { UNSENT_REPLY, type PromptAttachments } from "../attachments.ts";

/** The "# Attached by the user" block. The CLI reads files itself, so sent files are paths and skipped files are named with the reason. */
export function claudeAttachmentPrompt(att: PromptAttachments | undefined): string {
  if (!att || (!att.paths.length && !att.skipped.length)) return "";
  const read = att.readPaths ?? [];
  const parts: string[] = [];
  if (read.length) parts.push(`Read these with the Read tool (images too):\n${read.map((f) => `- ${f}`).join("\n")}`);
  if (att.skipped.length) parts.push(`${att.skipped.map((s) => `- ${s}`).join("\n")}\n${UNSENT_REPLY}`);
  if (!parts.length) return "";
  return `\n\n# Attached by the user\n${parts.join("\n")}`;
}

/**
 * Claude Code has no write_wiki tool. A project call asks for the same `wiki` array the planner returns,
 * and the orchestrator applies it after the run. No extra program and no network call.
 */
export const CLAUDE_WIKI_INSTRUCTIONS = `
# Project wiki
Your instructions already contain the wiki index and the Overview page. There is no read_wiki tool here.
You may update this project's pages. Do not call a write_wiki tool; it is not available here.
After your summary, end with one fenced json block and nothing after it:
\`\`\`json
{ "wiki": [ { "title": "", "section": "overview", "body": "markdown for the whole page" } ] }
\`\`\`
section is overview, architecture, roadmap (Road map), setup, decisions, or releases.
Update Overview, Architecture, Road map and Setup when your work changes them. A title is optional for those four; decisions and releases need a title.
Use "wiki": [] when nothing should change. Never a General page. The text before the json block is your summary.`;

/**
 * Runs Claude Code headless (`claude -p`) in the worktree, as the original dispatcher did.
 * Uses the provider's API key when one is set; otherwise the user's own Claude Code sign-in.
 */
/** The parts of the Claude CLI's JSON lines that are read here. */
type CliBlock = { type?: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown>; content?: unknown; is_error?: boolean };
type CliEvent = { type?: string; message?: { content?: CliBlock[] } };
type CliResult = {
  type?: string; result?: unknown; is_error?: boolean; subtype?: string; num_turns?: number; total_cost_usd?: number;
  usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
  permission_denials?: { tool_name?: string; tool_input?: unknown }[];
};

export class ClaudeCliEngine implements Engine {
  constructor(private program = process.env.AGENTDESK_CLAUDE_BIN || "claude") {}

  async run(req: EngineRequest): Promise<EngineResult> {
    const t0 = Date.now();
    const write = req.mode === "write";
    const allowed = write
      ? (req.agent.allowed_tools && req.agent.allowed_tools !== "[]" ? JSON.parse(req.agent.allowed_tools) : DEFAULT_WORKER_TOOLS)
      : READ_ONLY_TOOLS;
    parseAllowedTools(allowed); // validates the list shape

    let prompt = `${req.system}\n\n${req.prompt}`;
    const files = req.attachments?.paths ?? [];
    prompt += claudeAttachmentPrompt(req.attachments);
    if (req.output) {
      prompt += `\n\n# Output\nEnd your final message with one fenced \`\`\`json block that matches this JSON schema ` +
        `(${req.output.description}):\n\`\`\`json\n${JSON.stringify(req.output.input_schema, null, 2)}\n\`\`\``;
    } else if (req.writeWiki) {
      prompt += CLAUDE_WIKI_INSTRUCTIONS;
    }

    const args = ["-p", "--model", req.provider.model || "sonnet", "--max-turns", String(req.agent.max_turns || 60),
      "--output-format", "stream-json", "--verbose", "--permission-mode", write ? "acceptEdits" : "default",
      "--allowedTools", allowed.join(",")];
    // Attachments live outside the worktree; let Claude Code read their folder.
    const dirs = [...new Set(files.map((f) => dirname(f)))];
    for (const d of dirs) args.push("--add-dir", d);

    let result = null as CliResult | null;
    const transcript: TranscriptEntry[] = [{ t: 0, kind: "prompt", text: prompt.slice(0, 20_000) }];
    req.onStep?.(transcript[0]);
    const add = (e: Omit<TranscriptEntry, "t">) => {
      if (transcript.length >= 600) return;
      const entry = { t: Date.now() - t0, ...e };
      transcript.push(entry);
      req.onStep?.(entry);
    };
    const r = await runProgram(this.program, args, {
      cwd: req.cwd,
      env: req.provider.apiKey ? { ANTHROPIC_API_KEY: req.provider.apiKey } : {},
      stdin: prompt,
      timeoutMs: (req.agent.timeout_min || 60) * 60_000,
      signal: req.signal,
      onLine: (line, stream) => {
        if (stream === "stderr") { if (line.trim()) req.onLog?.(line); return; }
        let ev: CliEvent;
        try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "result") { result = ev; return; }
        if (ev.type === "user") {
          for (const b of ev.message?.content ?? []) {
            if (b.type === "tool_result") {
              const out = Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text ?? "").join("\n") : String(b.content ?? "");
              add({ kind: "tool", tool: "result", output: out.slice(0, 8_000), isError: !!b.is_error });
            }
          }
          return;
        }
        if (ev.type !== "assistant") return;
        for (const b of ev.message?.content ?? []) {
          if (b.type === "text" && b.text?.trim()) { req.onActivity?.("thinking"); req.onLog?.(b.text.slice(0, 500)); add({ kind: "model", text: b.text.slice(0, 20_000) }); }
          if (b.type === "thinking" && b.thinking?.trim()) add({ kind: "thinking", text: b.thinking.slice(0, 20_000) });
          if (b.type === "tool_use") {
            const { state, detail } = describeTool(String(b.name), b.input ?? {});
            req.onActivity?.(state, detail);
            req.onLog?.(`→ ${detail}`);
            add({ kind: "tool", tool: String(b.name), input: b.input });
          }
        }
      },
    });

    const seconds = Math.round((Date.now() - t0) / 1000);
    if (!result) {
      return { ok: false, summary: "", turns: 0, costUsd: null, tokensIn: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0, seconds,
        error: r.code === 127 ? `Claude Code CLI not found (${this.program}). Install it or set AGENTDESK_CLAUDE_BIN.`
          : `No result from claude (exit ${r.code}${r.timedOut ? ", timed out" : ""}): ${tail(r.stderr || r.stdout, 8)}` };
    }
    const u = result.usage ?? {};
    const summary = String(result.result ?? "");
    // Headless Claude Code cannot stop and ask; show every refused call so the list can be widened.
    for (const d of result.permission_denials ?? []) {
      add({ kind: "error", text: `Refused (not in the allowed list): ${d.tool_name} ${JSON.stringify(d.tool_input ?? {}).slice(0, 300)}` });
    }
    const out: EngineResult = {
      transcript,
      ok: !result.is_error,
      summary,
      turns: result.num_turns ?? 0,
      costUsd: result.total_cost_usd ?? null,
      tokensIn: u.input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
      seconds,
      error: result.is_error ? `${result.subtype ?? "error"}: ${summary.slice(0, 300)}` : undefined,
    };
    if (req.output && out.ok) {
      const parsed = lastJsonBlock(summary);
      if (parsed) out.output = parsed;
      else { out.ok = false; out.error = "The agent did not end with the requested JSON block"; }
    } else if (req.writeWiki && out.ok) {
      const taken = takeWikiFromSummary(summary);
      if (taken.wiki) {
        out.summary = taken.summary;
        out.output = { wiki: taken.wiki };
      }
    }
    return out;
  }
}

/** Pull a trailing wiki array out of a Claude CLI final message. The text before it stays the summary. */
export function takeWikiFromSummary(summary: string): { summary: string; wiki?: unknown[] } {
  const parsed = lastJsonBlock(summary);
  if (!parsed || !Array.isArray(parsed.wiki)) return { summary };
  const blocks = [...summary.matchAll(/```json\s*[\s\S]*?```/g)];
  if (blocks.length) {
    const last = blocks[blocks.length - 1];
    const at = last.index ?? 0;
    return { summary: (summary.slice(0, at) + summary.slice(at + last[0].length)).trim(), wiki: parsed.wiki };
  }
  const brace = summary.lastIndexOf("\n{");
  if (brace >= 0) return { summary: summary.slice(0, brace).trim(), wiki: parsed.wiki };
  return { summary: summary.trim(), wiki: parsed.wiki };
}

export function lastJsonBlock(text: string): Record<string, unknown> | undefined {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try { return JSON.parse(blocks[i][1]); } catch { /* try the previous one */ }
  }
  const brace = text.lastIndexOf("\n{");
  if (brace >= 0) { try { return JSON.parse(text.slice(brace + 1)); } catch { /* none */ } }
  return undefined;
}

function describeTool(name: string, input: Record<string, unknown>) {
  const file = String(input.file_path || input.path || input.pattern || "").split(/[\\/]/).slice(-2).join("/");
  switch (name) {
    case "Read": case "Glob": case "Grep": case "LS": return { state: "reading" as const, detail: `${name.toLowerCase()} ${file}` };
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit": return { state: "typing" as const, detail: `${name.toLowerCase()} ${file}` };
    case "Bash": return { state: "running" as const, detail: String(input.command ?? "").slice(0, 60) };
    default: return { state: "thinking" as const, detail: name };
  }
}
