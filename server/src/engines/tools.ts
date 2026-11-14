import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";
import type { ToolDef } from "../providers/types.ts";
import type { AgentState } from "../bus.ts";
import { runCommandLine, tail } from "../orchestrator/shell.ts";

/** File and command tools for the built-in agent loop. Every path stays inside the working folder. */

const SKIP_DIRS = new Set([".git", "node_modules", "bin", "obj", "dist", ".venv", "__pycache__", ".next"]);
const MAX_READ = 2000;

export type ToolContext = {
  cwd: string;
  canWrite: boolean;
  commandPrefixes: string[];
  signal?: AbortSignal;
  /** Asks the user about a command outside the allowed list; without it such commands are refused. */
  ask?: (command: string) => Promise<{ allowed: boolean; by?: string }>;
  /** Updates one project wiki page. Absent = write_wiki is refused. */
  writeWiki?: (page: { title: string; section: string; body: string }) => string;
};

export type ToolOutcome = { content: string; isError?: boolean; activity: AgentState; detail: string };

export const READ_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "List files under a folder (recursive). Optional glob such as **/*.ts. Skips .git, node_modules, build output.",
    input_schema: { type: "object", properties: { path: { type: "string" }, glob: { type: "string" } } },
  },
  {
    name: "read_file",
    description: `Read a text file with line numbers. Use offset/limit for long files (default first ${MAX_READ} lines).`,
    input_schema: {
      type: "object", required: ["path"],
      properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
    },
  },
  {
    name: "search",
    description: "Search file contents with a JavaScript regular expression. Returns path:line: text (max 200 hits).",
    input_schema: {
      type: "object", required: ["pattern"],
      properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" } },
    },
  },
  {
    name: "run_command",
    description: "Run an allowed shell command in the working folder. Allowed prefixes are listed in your instructions.",
    input_schema: { type: "object", required: ["command"], properties: { command: { type: "string" } } },
  },
];

export const WRITE_TOOLS: ToolDef[] = [
  {
    name: "write_file",
    description: "Create or overwrite a file with the full content.",
    input_schema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } },
  },
  {
    name: "edit_file",
    description: "Replace one exact occurrence of old_text with new_text. old_text must match exactly once.",
    input_schema: {
      type: "object", required: ["path", "old_text", "new_text"],
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
    },
  },
];

export const WIKI_TOOL: ToolDef = {
  name: "write_wiki",
  description: "Create or update a page in this project's wiki. overview, architecture, roadmap and setup replace that one page. decisions and releases are one page per title. General pages cannot be changed.",
  input_schema: {
    type: "object", required: ["title", "section", "body"],
    properties: {
      title: { type: "string" },
      section: { type: "string", description: "overview, architecture, roadmap, setup, decisions, or releases" },
      body: { type: "string", description: "Markdown for the whole page" },
    },
  },
};

export const FINISH_TOOL: ToolDef = {
  name: "finish",
  description: "Call once when the work is done. The summary is shown to the team: what changed, tests run, open points.",
  input_schema: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
};

function safePath(cwd: string, p: string | undefined): string {
  const root = resolve(cwd);
  const full = resolve(root, p || ".");
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`Path outside the working folder: ${p}`);
  return full;
}

export function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$+.()|{}[]".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

function walk(root: string, base: string, out: string[], limit = 5000) {
  for (const name of readdirSync(root)) {
    if (out.length >= limit) return;
    const full = join(root, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full, base, out, limit); }
    else out.push(relative(base, full).split(sep).join("/"));
  }
}

export function commandAllowed(command: string, prefixes: string[]): boolean {
  const c = command.trim();
  if (/[|><`]|\$\(/.test(c)) return false; // no pipes, redirects or substitutions
  const parts = c.split(/&&|;/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => prefixes.some((p) => part === p || part.startsWith(p + " ")));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- model-supplied JSON, each tool validates the fields it reads
export async function runTool(name: string, input: Record<string, any>, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "list_files": {
        const dir = safePath(ctx.cwd, input.path);
        const files: string[] = [];
        walk(dir, ctx.cwd, files);
        const re = input.glob ? globToRegex(String(input.glob)) : null;
        const hits = re ? files.filter((f) => re.test(f) || re.test(f.split("/").pop()!)) : files;
        return { content: hits.slice(0, 500).join("\n") + (hits.length > 500 ? `\n… ${hits.length - 500} more` : ""), activity: "reading", detail: `list ${input.path || "."}` };
      }
      case "read_file": {
        const file = safePath(ctx.cwd, input.path);
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        const offset = Math.max(1, Number(input.offset) || 1);
        const limit = Math.min(MAX_READ, Number(input.limit) || MAX_READ);
        const slice = lines.slice(offset - 1, offset - 1 + limit).map((l, i) => `${offset + i}\t${l}`);
        const more = lines.length > offset - 1 + limit ? `\n… (${lines.length} lines in total)` : "";
        return { content: slice.join("\n") + more, activity: "reading", detail: `read ${input.path}` };
      }
      case "search": {
        const re = new RegExp(String(input.pattern));
        const dir = safePath(ctx.cwd, input.path);
        const files: string[] = [];
        walk(dir, ctx.cwd, files);
        const g = input.glob ? globToRegex(String(input.glob)) : null;
        const hits: string[] = [];
        for (const f of files) {
          if (g && !g.test(f) && !g.test(f.split("/").pop()!)) continue;
          let text: string;
          try { text = readFileSync(join(ctx.cwd, f), "utf8"); } catch { continue; }
          if (text.includes("\u0000")) continue;
          text.split(/\r?\n/).forEach((l, i) => { if (hits.length < 200 && re.test(l)) hits.push(`${f}:${i + 1}: ${l.slice(0, 200)}`); });
          if (hits.length >= 200) break;
        }
        return { content: hits.join("\n") || "(no matches)", activity: "reading", detail: `search ${input.pattern}` };
      }
      case "write_file": {
        if (!ctx.canWrite) throw new Error("This agent may not change files");
        const file = safePath(ctx.cwd, input.path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, String(input.content ?? ""), "utf8");
        return { content: `Wrote ${input.path}`, activity: "typing", detail: `write ${input.path}` };
      }
      case "edit_file": {
        if (!ctx.canWrite) throw new Error("This agent may not change files");
        const file = safePath(ctx.cwd, input.path);
        if (!existsSync(file)) throw new Error(`No such file: ${input.path}`);
        const text = readFileSync(file, "utf8");
        const count = text.split(String(input.old_text)).length - 1;
        if (count !== 1) throw new Error(`old_text matches ${count} times; it must match exactly once`);
        writeFileSync(file, text.replace(String(input.old_text), () => String(input.new_text)), "utf8");
        return { content: `Edited ${input.path}`, activity: "typing", detail: `edit ${input.path}` };
      }
      case "write_wiki": {
        if (!ctx.canWrite || !ctx.writeWiki) throw new Error("This agent cannot edit the wiki");
        const content = ctx.writeWiki({ title: String(input.title ?? ""), section: String(input.section ?? ""), body: String(input.body ?? "") });
        return { content, activity: "typing", detail: `wiki ${String(input.title ?? "").slice(0, 40)}` };
      }
      case "run_command": {
        const command = String(input.command ?? "");
        if (!commandAllowed(command, ctx.commandPrefixes)) {
          if (!ctx.ask) throw new Error(`Command not allowed. Allowed prefixes: ${ctx.commandPrefixes.join(", ") || "(none)"}`);
          const answer = await ctx.ask(command);
          if (!answer.allowed) {
            throw new Error(`The user (${answer.by ?? "user"}) did not allow this command. Do the work without it, or say in your summary why it is needed.`);
          }
        }
        const r = await runCommandLine(command, "auto", { cwd: ctx.cwd, timeoutMs: 15 * 60_000, signal: ctx.signal });
        const out = tail(`${r.stdout}\n${r.stderr}`, 60);
        return { content: `exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n${out}`, isError: r.code !== 0, activity: "running", detail: command.slice(0, 60) };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  } catch (err) {
    return { content: String((err as Error).message ?? err), isError: true, activity: "thinking", detail: name };
  }
}
