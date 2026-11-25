import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Building2, GitMerge, NotebookPen, Paperclip, RotateCcw, ListChecks, MessageSquare, Play, Send, Trash2, Pencil } from "lucide-react";
import { ApiError, get, post, put, del, parseJson, uploadAttachment, useLiveEvents, useLoad, type Agent, type Chat, type Message, type Project, type Task, type Team } from "../api.ts";
import { clearDraft, getDraft, mergeById, setDraft } from "../lib/chatDraft.ts";
import { StatusBadge, Avatar, Modal, Field, money } from "../components/ui.tsx";
import { lookFor } from "../office/palette.ts";
import { Office } from "../office/Office.tsx";
import { TaskPanel } from "./TaskPanel.tsx";
import { MessageFiles, PendingFiles, type Pending } from "../components/Attachments.tsx";
import { useCapabilities } from "../components/Capabilities.tsx";
import { go } from "../App.tsx";
import { Choice } from "../components/inputs.tsx";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatUsage = { tokens: number; last_prompt_tokens: number; last_prompt_chars: number };
type ChatData = { chat: Chat; planner_id: number | null; planning: boolean; messages: Message[]; tasks: Task[]; usage?: ChatUsage };

function fmtTokens(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

// useLoad keeps nothing once this page unmounts, and it replaces the whole value. The route renders ChatPage only
// while a chat is open, so the last payload lives here and the next visit merges it the same way live events do.
const chatCache = new Map<number, ChatData>();
const scrollPlaces = new Map<number, { top: number; atBottom: boolean }>();
let agentsCache: Agent[] = [];
let teamsCache: Team[] = [];
const NEAR_BOTTOM = 48;

function mergeChat(prev: ChatData | null, next: ChatData): ChatData {
  if (!prev) return next;
  // Messages are only added, so a live message the refresh has not seen yet stays. A file note arrives
  // on a message that is already on screen, so that field is copied from the fresh copy.
  const messages = mergeById(prev.messages, next.messages, false).map((m) => {
    const fresh = next.messages.find((n) => n.id === m.id);
    if (!fresh?.attachments?.some((a) => a.note)) return m;
    return { ...m, attachments: fresh.attachments };
  });
  return { ...next, messages, tasks: mergeById(prev.tasks, next.tasks, true) };
}

function forgetChat(chatId: number) {
  chatCache.delete(chatId);
  scrollPlaces.delete(chatId);
  clearDraft(chatId);
}

export function ChatPage({ chatId, tab = "chat", projects, onChanged }: { chatId: number; tab?: string; projects: Project[]; onChanged: () => void }) {
  const [data, setData] = useState<ChatData | null>(() => chatCache.get(chatId) ?? null);
  const [agents, setAgents] = useState<Agent[]>(() => agentsCache);
  const [planning, setPlanning] = useState(() => chatCache.get(chatId)?.planning ?? false);
  const [teams, setTeams] = useState<Team[]>(() => teamsCache);
  const planningRef = useRef(planning);

  const commit = (fn: (d: ChatData) => ChatData) => {
    setData((d) => {
      if (!d) return d;
      const next = { ...fn(d), planning: planningRef.current };
      chatCache.set(chatId, next);
      return next;
    });
  };
  const markPlanning = (b: boolean) => {
    planningRef.current = b;
    setPlanning(b);
    const cur = chatCache.get(chatId);
    if (cur) chatCache.set(chatId, { ...cur, planning: b });
  };

  useEffect(() => {
    let cancelled = false;
    get<ChatData>(`/api/chats/${chatId}`).then((d) => {
      if (cancelled) return;
      planningRef.current = d.planning;
      setPlanning(d.planning);
      setData((prev) => {
        // planningRef may have moved since this snapshot was read (a live event); keep that.
        const next = { ...mergeChat(prev ?? chatCache.get(chatId) ?? null, d), planning: planningRef.current };
        chatCache.set(chatId, next);
        return next;
      });
    }).catch((e: unknown) => {
      // A chat that was deleted goes home and drops its draft. A failed refresh keeps the copy already on screen.
      if (!(e instanceof ApiError) || e.status !== 404) {
        if (!chatCache.get(chatId)) go("");
        return;
      }
      forgetChat(chatId);
      go("");
    });
    get<Agent[]>("/api/agents").then((rows) => { agentsCache = rows; if (!cancelled) setAgents(rows); });
    get<Team[]>("/api/teams").then((rows) => { teamsCache = rows; if (!cancelled) setTeams(rows); });
    return () => { cancelled = true; };
  }, [chatId]);

  useLiveEvents((ev) => {
    if (ev.type === "message" && ev.chatId === chatId) {
      if (ev.message.role !== "user") {
        markPlanning(false);
        get<ChatData>(`/api/chats/${chatId}`).then((fresh) => commit((d) => ({ ...d, usage: fresh.usage }))).catch(() => {});
      }
      commit((d) => {
        const chat = d.chat.title === "New chat" && ev.message.role === "user"
          ? { ...d.chat, title: ev.message.content.split("\n")[0].slice(0, 60) } : d.chat;
        // The same message is published again when an attachment note is known. Replace it so the note shows.
        const i = d.messages.findIndex((m) => m.id === ev.message.id);
        if (i >= 0) {
          const messages = d.messages.slice();
          messages[i] = ev.message;
          return { ...d, chat, messages };
        }
        return { ...d, chat, messages: [...d.messages, ev.message] };
      });
    }
    if (ev.type === "task" && ev.chatId === chatId) {
      commit((d) => {
        const i = d.tasks.findIndex((t) => t.id === ev.task.id);
        const tasks = i < 0 ? [...d.tasks, ev.task] : d.tasks.map((t) => (t.id === ev.task.id ? ev.task : t));
        return { ...d, tasks };
      });
    }
    if (ev.type === "agent" && ev.chatId === chatId && ev.state === "thinking" && ev.detail === "plan") markPlanning(true);
  });

  if (!data) return null;
  const project = projects.find((p) => p.id === data.chat.project_id);
  const active = data.tasks.filter((t) => ["queued", "building", "verifying", "reviewing"].includes(t.status)).length;
  const setTab = (t: string) => go(`chat/${chatId}${t === "chat" ? "" : `?tab=${t}`}`);

  const team = teams.find((t) => t.id === (data.chat.team_id ?? project?.team_id));
  const applyFresh = (fresh: ChatData) => {
    planningRef.current = fresh.planning;
    setPlanning(fresh.planning);
    setData((d) => {
      const next = { ...mergeChat(d, fresh), planning: fresh.planning };
      chatCache.set(chatId, next);
      return next;
    });
  };
  const setTeam = async (teamId: number | null) => {
    await put(`/api/chats/${chatId}`, { team_id: teamId });
    applyFresh(await get<ChatData>(`/api/chats/${chatId}`));
  };
  const planners = agents.filter((a) => a.role === "planner" && a.enabled);
  const setPlanner = async (plannerId: number | null) => {
    await put(`/api/chats/${chatId}`, { planner_id: plannerId });
    applyFresh(await get<ChatData>(`/api/chats/${chatId}`));
  };
  const rename = async () => {
    const title = prompt("Chat title", data.chat.title);
    if (!title) return;
    await put(`/api/chats/${chatId}`, { title });
    commit((d) => ({ ...d, chat: { ...d.chat, title } }));
    onChanged();
  };
  const remove = async () => {
    if (!confirm("Delete this chat and its task history? Branches and worktrees stay on disk.")) return;
    await del(`/api/chats/${chatId}`);
    forgetChat(chatId);
    onChanged();
    go("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <SidebarTrigger />
        <span className="truncate text-sm text-muted-foreground">{project?.name}</span>
        <span className="text-muted-foreground">/</span>
        <h1 className="truncate text-sm font-medium">{data.chat.title}</h1>
        {!!data.usage?.tokens && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={data.usage.last_prompt_chars > 0
            ? "Tokens of every call in this chat. The last prompt size is a rough count (about 4 characters per token) of the instructions and prompt on the latest call."
            : "Tokens of every call in this chat. The last prompt size is the input tokens of the latest call."}>
            {fmtTokens(data.usage.tokens)} tokens · last prompt ~{fmtTokens(data.usage.last_prompt_chars > 0 ? Math.round(data.usage.last_prompt_chars / 4) : data.usage.last_prompt_tokens)}
          </span>
        )}
        <Button variant="ghost" size="icon-sm" title="Rename" onClick={rename}><Pencil /></Button>
        <Button variant="ghost" size="icon-sm" title="Delete chat" onClick={remove}><Trash2 /></Button>
        {teams.length > 0 && (
          <Choice size="sm" className="w-auto max-w-56" title={`Team working on this chat: ${team?.name ?? "every enabled agent"}`}
            value={data.chat.team_id ? String(data.chat.team_id) : ""} onValueChange={(v) => setTeam(v ? Number(v) : null)}
            options={[
              { value: "", label: `Team: ${teams.find((t) => t.id === project?.team_id)?.name ?? "all agents"} (project's)` },
              ...teams.filter((t) => t.id !== project?.team_id).map((t) => ({ value: String(t.id), label: `Team: ${t.name}` })),
            ]} />
        )}
        {planners.length > 0 && (
          <Choice size="sm" className="w-auto max-w-56" title="Planner who answers the next message in this chat"
            value={data.chat.planner_id ? String(data.chat.planner_id) : ""} onValueChange={(v) => setPlanner(v ? Number(v) : null)}
            options={[
              { value: "", label: data.chat.planner_id ? "Planner: automatic (project / team)" : `Planner: ${agents.find((a) => a.id === data.planner_id)?.name ?? "none"} (automatic)` },
              ...planners.map((a) => ({ value: String(a.id), label: `Planner: ${a.name}` })),
            ]} />
        )}
        <Tabs value={tab} onValueChange={setTab} className="ml-auto w-auto">
          <TabsList>
            <TabsTrigger value="chat"><MessageSquare data-icon="inline-start" /> Chat</TabsTrigger>
            <TabsTrigger value="tasks"><ListChecks data-icon="inline-start" /> Running tasks{active ? ` · ${active}` : ""}</TabsTrigger>
            <TabsTrigger value="office"><Building2 data-icon="inline-start" /> Office</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {project?.process === "scrum" && <ScrumBar projectId={project.id} />}
        <div className="min-h-0 flex-1">
          {tab === "tasks" ? <TaskPanel chatId={chatId} agents={agents} />
            : tab === "office" ? <Office chatId={chatId} />
            : <ChatView data={data} agents={agents} planning={planning} setPlanning={markPlanning} openTasks={() => setTab("tasks")} />}
        </div>
      </div>
    </div>
  );
}

/** 404 means the upload is gone. Any other result (including a network miss) leaves the send to try. */
async function attachmentStillThere(id: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/attachments/${id}`, { method: "HEAD", credentials: "same-origin" });
    return res.status !== 404;
  } catch {
    return true;
  }
}

function placeOf(el: HTMLElement) {
  return { top: el.scrollTop, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM };
}

function ChatView({ data, agents, planning, setPlanning, openTasks }: {
  data: ChatData; agents: Agent[]; planning: boolean; setPlanning: (b: boolean) => void; openTasks: () => void;
}) {
  const chatId = data.chat.id;
  const [text, setText] = useState(() => getDraft(chatId).text);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [files, setFiles] = useState<Pending[]>(() => getDraft(chatId).files);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The draft store is updated outside setState so an upload that finishes after a page change is not dropped.
  const writeFiles = (next: Pending[]) => {
    setFiles(next);
    setDraft(chatId, { text: getDraft(chatId).text, files: next });
  };
  const writeText = (value: string) => {
    setText(value);
    setDraft(chatId, { text: value, files: getDraft(chatId).files });
  };

  const addFiles = (list: FileList | File[]) => {
    const added: Pending[] = [];
    for (const file of Array.from(list)) {
      const key = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      added.push({ key, name: file.name || "pasted image", mime: file.type, size: file.size, preview });
      uploadAttachment(chatId, file)
        .then((a) => writeFiles(getDraft(chatId).files.map((x) => (x.key === key ? { ...x, id: a.id, name: a.name } : x))))
        .catch((e) => writeFiles(getDraft(chatId).files.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x))));
    }
    writeFiles([...getDraft(chatId).files, ...added]);
  };
  const removeFile = (key: string) => {
    const cur = getDraft(chatId);
    const gone = cur.files.find((y) => y.key === key);
    if (gone?.id) del(`/api/attachments/${gone.id}`).catch(() => {});
    // Revoke on remove or after a successful send. Not on unmount: the same preview is shown when the chat is opened again.
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    writeFiles(cur.files.filter((y) => y.key !== key));
  };
  const uploading = files.some((f) => !f.id && !f.error);
  const caps = useCapabilities(`/api/chats/${chatId}/planner-capabilities?team=${data.chat.team_id ?? ""}&planner=${data.planner_id ?? ""}`);
  const hasImages = files.some((f) => f.mime.startsWith("image/"));
  const ready = files.filter((f) => f.id && !f.error);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(scrollPlaces.get(chatId)?.atBottom !== false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPlaces.get(chatId);
    if (saved && !saved.atBottom) el.scrollTop = Math.min(saved.top, el.scrollHeight);
    else el.scrollTop = el.scrollHeight;
  }, [chatId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const save = () => {
      // A collapsed pane looks like the bottom. Only a real scroll, on a list tall enough to move, is stored.
      if (!el.isConnected || el.clientHeight < 40 || el.scrollHeight <= el.clientHeight) return;
      const place = placeOf(el);
      stickToBottom.current = place.atBottom;
      scrollPlaces.set(chatId, place);
    };
    // Our own scrollTo is untrusted. A reader moving the list is trusted, and that is what decides whether to follow the bottom.
    const onScroll = (ev: Event) => { if (ev.isTrusted) save(); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); };
  }, [chatId]);
  // The first paint is placed by the layout effect. Later messages follow the bottom only when the reader was already there.
  const followBottom = useRef(false);
  useEffect(() => {
    if (!followBottom.current) { followBottom.current = true; return; }
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [data.messages.length, planning]);

  const send = async () => {
    const content = text.trim();
    const pending = getDraft(chatId).files.filter((f) => f.id && !f.error);
    if ((!content && !pending.length) || planning || getDraft(chatId).files.some((f) => !f.id && !f.error)) return;
    setError("");
    const missing = new Set<string>();
    for (const f of pending) {
      if (f.id !== undefined && !(await attachmentStillThere(f.id))) missing.add(f.key);
    }
    if (missing.size) writeFiles(getDraft(chatId).files.map((f) => (missing.has(f.key) ? { ...f, error: "Not in the cache any more" } : f)));
    const ids = getDraft(chatId).files.flatMap((f) => (f.id !== undefined && !f.error ? [f.id] : []));
    if (!content && !ids.length) return;
    try {
      await post(`/api/chats/${chatId}/messages`, { content, attachment_ids: ids });
      const sent = new Set(ids);
      for (const f of getDraft(chatId).files) if (f.id !== undefined && sent.has(f.id) && f.preview) URL.revokeObjectURL(f.preview);
      const keep = getDraft(chatId).files.filter((f) => f.id === undefined || !sent.has(f.id));
      setText("");
      setFiles(keep);
      setDraft(chatId, { text: "", files: keep });
      setPlanning(true);
    } catch (e) { setError((e as Error).message); }
  };

  const agent = (id: number | null) => agents.find((a) => a.id === id);
  const planner = agents.find((a) => a.id === data.planner_id) ?? agents.find((a) => a.role === "planner" && a.enabled);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-auto px-6 py-4" ref={scrollRef}>
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {data.messages.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Start the conversation</EmptyTitle>
                <EmptyDescription>
                  Describe what you want built or changed. {planner ? <><b>{planner.name}</b> reads the code and proposes tasks.</> : <>Create a planner under <a href="#/agents">Agents</a> first.</>}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {data.messages.map((m) => {
            const a = agent(m.agent_id);
            const tasks = data.tasks.filter((t) => t.message_id === m.id);
            return (
              <div key={m.id} className={cn("flex flex-col gap-1", m.role === "user" && "items-end", m.role === "event" && "border-l-2 pl-3 text-sm text-muted-foreground")}>
                {m.role !== "event" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {a && <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={18} />}
                    {m.role === "user" ? "You" : a?.name ?? "Agent"}
                  </div>
                )}
                {!(m.attachments?.length && m.content === "(see the attached files)") && (
                  <div className={cn("markdown", m.role === "user" && "max-w-[85%] rounded-lg bg-muted px-3 py-2", m.role === "event" && "text-foreground")}>
                    <Markdown>{m.content}</Markdown>
                  </div>
                )}
                {m.attachments?.length ? <MessageFiles files={m.attachments} /> : null}
                {tasks.length > 0 && <PlanCard tasks={tasks} agents={agents} messageId={m.id} onEdit={setEditing} openTasks={openTasks} />}
                {(() => {
                  const plan = parseJson<PlanExtras>(m.plan, {});
                  return <>
                    {plan.merge_ids?.length ? <ActionCard kind="merge" items={plan.merge_ids.map((id) => ({ id }))} agents={agents} /> : null}
                    {plan.retry?.length ? <ActionCard kind="retry" items={plan.retry} agents={agents} /> : null}
                    {plan.journal?.length ? <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground"><NotebookPen /> Noted for later chats: {plan.journal.join(" · ")}</div> : null}
                  </>;
                })()}
              </div>
            );
          })}
          {planning && (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">{planner?.name ?? "Planner"}</div>
              <span className="inline-flex gap-1"><i className="typing-dot" /><i className="typing-dot" /><i className="typing-dot" /></span>
            </div>
          )}
        </div>
      </div>
      <div className="border-t bg-background px-6 py-3">
        {hasImages && caps?.vision === false && (
          <p className="mx-auto mb-1.5 max-w-3xl text-xs text-warning">⚠ {caps.agent} runs on <code>{caps.model}</code>, which cannot read images: they are sent as file names only. Use a vision model or Claude for the planner to discuss screenshots.</p>
        )}
        {hasImages && caps && caps.vision === null && caps.agent && (
          <p className="mx-auto mb-1.5 max-w-3xl text-xs text-warning">{caps.agent}'s model (<code>{caps.model}</code>) does not say whether it reads images ({caps.source}). If it can't, the reply will ignore them.</p>
        )}
        <div role="group" aria-label="Message" className={cn("mx-auto flex max-w-3xl flex-wrap items-end gap-2 rounded-xl border bg-card p-2", dragging && "border-primary ring-3 ring-primary/30")}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}>
          <PendingFiles files={files} onRemove={removeFile} />
          <Button type="button" variant="ghost" size="icon-sm" title="Attach files (or paste / drop them here)" onClick={() => fileInput.current?.click()}>
            <Paperclip />
          </Button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Textarea
            className="max-h-[40dvh] min-h-11 flex-1 resize-none overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder={planning ? "The planner is working on it…" : "What should the team do? Paste or drop screenshots and files. (Enter to send, Shift+Enter for a new line)"}
            value={text}
            onChange={(e) => writeText(e.target.value)}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          <Button size="icon" onClick={send} disabled={planning || uploading || (!text.trim() && !ready.length)} aria-label="Send"
            title={uploading ? "Waiting for uploads" : undefined}><Send /></Button>
        </div>
        {error && <p className="mx-auto mt-1.5 max-w-3xl text-sm text-destructive">{error}</p>}
      </div>
      {editing && <EditTask task={editing} agents={agents} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlanCard({ tasks, agents, messageId, onEdit, openTasks }: {
  tasks: Task[]; agents: Agent[]; messageId: number; onEdit: (t: Task) => void; openTasks: () => void;
}) {
  const proposed = tasks.filter((t) => t.status === "proposed");
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await post(`/api/messages/${messageId}/run`); } finally { setBusy(false); } };
  const total = tasks.reduce((s, t) => s + t.cost_usd, 0);
  return (
    <Card className="w-full gap-0 py-0">
      {tasks.map((t) => {
        const w = agents.find((a) => a.id === t.worker_id);
        return (
          <div key={t.id} className="flex items-start gap-2.5 border-b px-3 py-2">
            {w ? <Avatar look={lookFor(w.name, parseJson(w.appearance, {}))} size={22} /> : <span className="w-5" />}
            <div className="min-w-0 flex-1">
              <b>{t.title}</b>
              <div className="text-xs text-muted-foreground">{w?.name ?? "any developer"} · <span className="font-mono">{parseJson<string[]>(t.paths, []).join(" ") || "any path"}</span></div>
            </div>
            <StatusBadge status={t.status} />
            {t.status === "proposed" && <Button variant="outline" size="sm" onClick={() => onEdit(t)}>Edit</Button>}
          </div>
        );
      })}
      <div className="flex items-center gap-2 rounded-b-xl bg-muted px-3 py-2">
        {proposed.length > 0
          ? <Button size="sm" onClick={run} disabled={busy}><Play data-icon="inline-start" /> Run {proposed.length === tasks.length ? "plan" : `${proposed.length} tasks`}</Button>
          : <Button variant="outline" size="sm" onClick={openTasks}>Open running tasks</Button>}
        <span className="ml-auto text-xs text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"}{total ? ` · ${money(total)}` : ""}</span>
      </div>
    </Card>
  );
}

type PlanExtras = { merge_ids?: number[]; retry?: { id: number; worker_id?: number }[]; journal?: string[] };

function ActionCard({ kind, items, agents }: { kind: "merge" | "retry"; items: { id: number; worker_id?: number }[]; agents: Agent[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<number, string>>({});
  const ids = items.map((i) => i.id);
  const idKey = ids.join(",");
  useEffect(() => { get<Task[]>(`/api/tasks?ids=${idKey}`).then(setTasks); }, [idKey]);
  useLiveEvents((ev) => { if (ev.type === "task" && ids.includes(ev.task.id)) setTasks((l) => l.map((t) => (t.id === ev.task.id ? ev.task : t))); });

  const RETRYABLE = ["failed", "needs_attention", "interrupted", "cancelled"];
  const ready = tasks.filter((t) => (kind === "merge" ? t.status === "approved" : RETRYABLE.includes(t.status)));
  const name = (id?: number | null) => agents.find((a) => a.id === id)?.name;
  const runAll = async () => {
    setBusy(true);
    for (const t of ready) {
      try {
        const worker_id = items.find((i) => i.id === t.id)?.worker_id;
        const r = await post<{ result?: string }>(`/api/tasks/${t.id}/${kind}`, kind === "retry" && worker_id ? { worker_id } : {});
        setResults((x) => ({ ...x, [t.id]: kind === "merge" ? `✓ ${r.result}` : "✓ queued" }));
      } catch (e) { setResults((x) => ({ ...x, [t.id]: `✗ ${(e as Error).message}` })); }
    }
    setBusy(false);
  };
  return (
    <Card className="w-full gap-2 p-3">
      {tasks.map((t) => {
        const to = items.find((i) => i.id === t.id)?.worker_id;
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={t.status} /><b>{t.title}</b>
            <span className="text-xs text-muted-foreground">{to && to !== t.worker_id ? `${name(t.worker_id) ?? "–"} → ${name(to)}` : name(t.worker_id)}</span>
            {t.chat_id !== undefined && <a className="text-xs" href={`#/chat/${t.chat_id}`}>open chat</a>}
            {results[t.id] && <span className={results[t.id].startsWith("✓") ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{results[t.id]}</span>}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !ready.length} onClick={runAll}>
          {kind === "merge" ? <GitMerge data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
          {busy ? (kind === "merge" ? "Merging…" : "Queuing…") : ready.length
            ? `${kind === "merge" ? "Merge" : "Run again"}: ${ready.length} task${ready.length === 1 ? "" : "s"}`
            : kind === "merge" ? "Nothing left to merge" : "Nothing left to run"}
        </Button>
        <span className="text-xs text-muted-foreground">{kind === "merge" ? "Squash-merges into the base branch (GitHub: the pull request)." : "Runs on the same branch; progress under Running tasks."}</span>
      </div>
    </Card>
  );
}

function EditTask({ task, agents, onClose }: { task: Task; agents: Agent[]; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [spec, setSpec] = useState(task.spec);
  const [paths, setPaths] = useState(parseJson<string[]>(task.paths, []).join("\n"));
  const [worker, setWorker] = useState(String(task.worker_id ?? ""));
  const [error, setError] = useState("");
  const save = async () => {
    try { await put(`/api/tasks/${task.id}`, { title, spec, paths, worker_id: worker ? Number(worker) : null }); onClose(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title="Edit task before it runs" onClose={onClose} wide footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Developer">
          <Choice value={worker} onValueChange={setWorker} options={[{ value: "", label: "Any free developer" }, ...agents.filter((a) => a.role === "worker").map((a) => ({ value: String(a.id), label: a.name }))]} />
        </Field>
        <Field label="Allowed paths (one per line)"><Textarea className="font-mono text-xs" rows={2} value={paths} onChange={(e) => setPaths(e.target.value)} /></Field>
      </div>
      <Field label="Spec (Markdown)"><Textarea className="min-h-64 font-mono text-xs" rows={16} value={spec} onChange={(e) => setSpec(e.target.value)} /></Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}

function ScrumBar({ projectId }: { projectId: number }) {
  const { data, reload } = useLoad<{ cycle: { text: string } }>(`/api/projects/${projectId}/scrum`);
  useLiveEvents((ev) => { if (ev.type === "scrum" && ev.projectId === projectId) reload(); });
  if (!data) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-accent px-4 py-1.5 text-sm">
      <b>Scrum</b><span className="min-w-0 flex-1 truncate">{data.cycle.text}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">Ask for anything new; the product manager adds it to the backlog.</span>
      <a href={`#/scrum/${projectId}`}>Backlog & PIs</a>
    </div>
  );
}
