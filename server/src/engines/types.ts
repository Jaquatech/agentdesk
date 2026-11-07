import type { AgentState } from "../bus.ts";
import type { ChatProvider, ProviderKind, ToolDef } from "../providers/types.ts";

export type AgentRow = {
  id: number; name: string; role: "planner" | "worker" | "reviewer"; provider_id: number | null;
  model: string; context: string; max_turns: number; timeout_min: number; allowed_tools: string;
  appearance: string; enabled: number; ask_approval?: number; thinking?: string;
};

export type ResolvedProvider = {
  id: number; name: string; kind: ProviderKind; model: string; apiKey?: string; baseUrl: string;
  /** Price of the model this call uses; undefined = not priced (cost shows as unknown). */
  price?: import("../pricing.ts").ModelPrice;
  /** Set for API kinds; the Claude CLI kind runs the `claude` program instead. */
  chat?: ChatProvider;
};

export type EngineRequest = {
  agent: AgentRow;
  provider: ResolvedProvider;
  cwd: string;
  /** Role instructions + project context + agent starting context. */
  system: string;
  prompt: string;
  /** read = may look and run read-only git commands; write = may edit files and run allowed commands. */
  mode: "read" | "write";
  /** When set, the agent must finish by returning an object for this schema (plan, verdict). */
  output?: ToolDef;
  /** Files the user attached to the message (planner). */
  attachments?: import("../attachments.ts").PromptAttachments;
  signal?: AbortSignal;
  onActivity?: (state: AgentState, detail?: string) => void;
  onLog?: (line: string) => void;
  /** Asks the user before a command outside the allowed list (pauses the run). Absent = refuse. */
  askApproval?: (q: { kind: "command"; command: string; cwd: string }) => Promise<{ allowed: boolean; by?: string }>;
  /** Each run-log step as it happens (live Activity view). */
  onStep?: (entry: TranscriptEntry) => void;
};

/** One step of a run, for the run log: what was sent, what the model said and did, what came back. */
export type TranscriptEntry = {
  /** ms since the run started */
  t: number;
  kind: "instructions" | "prompt" | "thinking" | "model" | "tool" | "note" | "error";
  text?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  /** model turn duration and tokens */
  ms?: number;
  tokens?: { in: number; out: number; cacheRead?: number };
};

export type EngineResult = {
  transcript?: TranscriptEntry[];
  ok: boolean;
  summary: string;
  output?: Record<string, unknown>;
  turns: number;
  costUsd: number | null;
  /** Uncached input tokens. */
  tokensIn: number;
  cacheRead: number;
  cacheWrite: number;
  tokensOut: number;
  seconds: number;
  error?: string;
};

export interface Engine {
  run(req: EngineRequest): Promise<EngineResult>;
}

/** Same syntax as Claude Code: `Read`, `Edit`, `Bash(npm test:*)`. */
export function parseAllowedTools(raw: string | string[]): { tools: Set<string>; commandPrefixes: string[] } {
  const list = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw) as string[]; } catch { return []; } })();
  const tools = new Set<string>();
  const commandPrefixes: string[] = [];
  for (const item of list) {
    const m = /^Bash\((.*?)(?::\*)?\)$/.exec(item.trim());
    if (m) commandPrefixes.push(m[1].trim());
    else tools.add(item.trim());
  }
  return { tools, commandPrefixes };
}

export const DEFAULT_WORKER_TOOLS = [
  "Read", "Edit", "Write", "Glob", "Grep", "TodoWrite",
  "Bash(npm test:*)", "Bash(npm run:*)", "Bash(npx vitest:*)", "Bash(npx tsc:*)",
  "Bash(dotnet build:*)", "Bash(dotnet test:*)", "Bash(python:*)", "Bash(pytest:*)",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(ls:*)",
];

export const READ_ONLY_TOOLS = [
  "Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)", "Bash(ls:*)",
];
