import { useEffect, useRef, useState, useCallback } from "react";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth")) window.dispatchEvent(new Event("agentdesk:signed-out"));
    throw new ApiError(data.error ?? res.statusText, res.status);
  }
  return data as T;
}

export const get = <T = any>(url: string) => api<T>("GET", url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>("POST", url, body);
export const put = <T = any>(url: string, body: unknown) => api<T>("PUT", url, body);
export const del = <T = any>(url: string) => api<T>("DELETE", url);

// ---------- types ----------

export type Role = "planner" | "worker" | "reviewer";
export type ProviderKind = "anthropic" | "openai" | "ollama" | "claude-cli";
export type Appearance = { shirt?: string; hair?: string; skin?: string; hairStyle?: number };

export type Agent = {
  id: number; name: string; role: Role; provider_id: number | null; provider_name?: string; provider_kind?: ProviderKind;
  model: string; context: string; max_turns: number; timeout_min: number; allowed_tools: string; appearance: string; enabled: number;
  ask_approval?: number; team_ids?: number[]; thinking?: string;
};
export type Team = {
  id: number; name: string; description: string; planner_id: number | null; reviewer_id: number | null;
  architect_id?: number | null; security_id?: number | null;
  member_ids: number[]; project_count: number;
};
export type Provider = {
  id: number; name: string; kind: ProviderKind; base_url: string; secret_id: number | null; secret_name?: string;
  default_model: string; price_in: number; price_out: number;
};
export type Secret = { id: number; name: string; hint: string; updated_at: string };
export type Project = {
  id: number; name: string; source: "local" | "github" | "azure"; path: string; repo_url: string; base_branch: string;
  shell: string; setup: string; verify: string; allowed_paths: string; context: string; chat_count?: number; team_id?: number | null;
  process?: "free" | "scrum"; points_per_dev?: number;
};
export type Chat = { id: number; project_id: number; title: string; updated_at: string; active_tasks?: number; team_id?: number | null };
export type AttachmentInfo = { id: number; name: string; mime: string; size: number };
export type Message = {
  id: number; chat_id: number; role: "user" | "assistant" | "event"; agent_id: number | null; content: string; plan: string | null;
  created_at: string; attachments?: AttachmentInfo[];
};

/** Uploads one file as the raw request body (no base64), for a chat. */
export async function uploadAttachment(chatId: number, file: File): Promise<AttachmentInfo> {
  const name = file.name || `pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.${(file.type.split("/")[1] || "bin").replace("jpeg", "jpg")}`;
  const res = await fetch(`/api/chats/${chatId}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(file.type || "application/octet-stream")}`, {
    method: "POST", headers: { "content-type": "application/octet-stream" }, body: file, credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status === 413 ? "File is larger than 15 MB" : data.error ?? res.statusText, res.status);
  return data as AttachmentInfo;
}
export type TaskStatus = "proposed" | "queued" | "building" | "verifying" | "reviewing" | "approved" | "merged"
  | "needs_attention" | "failed" | "cancelled" | "interrupted";
export type Task = {
  id: number; chat_id: number; project_id: number; message_id: number | null; slug: string; title: string; spec: string; paths: string;
  worker_id: number | null; reviewer_id: number | null; status: TaskStatus; round: number; branch: string; worktree: string;
  commit_sha: string; pr_url: string; verdict: string; summary: string; review: string; error: string; cost_usd: number; tokens: number;
  created_at: string; updated_at: string; chat_title?: string; project_name?: string;
  sprint_id?: number | null; sprint_number?: number | null; sprint_status?: string | null;
};
export type Run = {
  id: number; kind: string; round: number; model: string; status: string; turns: number | null; cost_usd: number | null;
  tokens_in: number; tokens_out: number; seconds: number | null; summary: string; log: string; agent_id: number | null; started_at: string;
};
export type Check = { command: string; step: number; status: "passed" | "failed" | "not_run"; exit: number | null; ms: number | null };
export type TaskChecks = { run_id: number | null; running: boolean; items: Check[] };
export type AgentState = "idle" | "thinking" | "reading" | "typing" | "running" | "reviewing" | "waiting" | "error";
export type Activity = { agentId: number; state: AgentState; detail?: string; taskId?: number; chatId?: number };

export type LiveEvent =
  | { type: "hello"; activity: Activity[] }
  | { type: "message"; chatId: number; message: Message }
  | { type: "task"; chatId: number; task: Task }
  | ({ type: "agent" } & Activity)
  | { type: "log"; taskId: number; line: string }
  | { type: "step"; taskId?: number; runId: number; entry: unknown }
  | { type: "approval"; approval: Approval }
  | { type: "scrum"; projectId: number };

export type Approval = {
  id: number; task_id: number | null; run_id: number | null; chat_id: number | null; agent_id: number | null;
  kind: string; request: string; cwd: string; status: "pending" | "allowed" | "denied" | "expired";
  decided_by: string; rule: string; created_at: string; decided_at: string | null;
  agent: string | null; task: string | null; chat: string | null; project: string | null;
};

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

// ---------- live events: one EventSource shared by every view ----------

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureSource() {
  if (source) return;
  source = new EventSource("/api/events");
  source.onmessage = (m) => {
    let ev: LiveEvent;
    try { ev = JSON.parse(m.data); } catch { return; }
    listeners.forEach((l) => l(ev));
  };
  source.onerror = () => {
    // The browser reconnects by itself; a closed source (signed out) is reopened on the next subscribe.
    if (source?.readyState === EventSource.CLOSED) source = null;
  };
}

export function closeLiveEvents() {
  source?.close();
  source = null;
}

export function useLiveEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensureSource();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

/** Loads data once and again when `deps` change; `reload` refetches. */
export function useLoad<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!url) return;
    get<T>(url).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [url]);
  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, setData, error, reload };
}
