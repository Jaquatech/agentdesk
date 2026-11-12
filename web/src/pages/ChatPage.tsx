import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Building2, GitMerge, NotebookPen, Paperclip, RotateCcw, ListChecks, MessageSquare, Play, Send, Trash2, Pencil } from "lucide-react";
import { get, post, put, del, parseJson, uploadAttachment, useLiveEvents, useLoad, type Agent, type Chat, type Message, type Project, type Task, type Team } from "../api.ts";
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

type ChatData = { chat: Chat; planner_id: number | null; planning: boolean; messages: Message[]; tasks: Task[] };

export function ChatPage({ chatId, tab = "chat", projects, onChanged }: { chatId: number; tab?: string; projects: Project[]; onChanged: () => void }) {
  const [data, setData] = useState<ChatData | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [planning, setPlanning] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    get<ChatData>(`/api/chats/${chatId}`).then((d) => { setData(d); setPlanning(d.planning); }).catch(() => go(""));
    get<Agent[]>("/api/agents").then(setAgents);
    get<Team[]>("/api/teams").then(setTeams);
  }, [chatId]);

  useLiveEvents((ev) => {
    if (ev.type === "message" && ev.chatId === chatId) {
      setData((d) => {
        if (!d || d.messages.some((m) => m.id === ev.message.id)) return d;
        const chat = d.chat.title === "New chat" && ev.message.role === "user"
          ? { ...d.chat, title: ev.message.content.split("\n")[0].slice(0, 60) } : d.chat;
        return { ...d, chat, messages: [...d.messages, ev.message] };
      });
      if (ev.message.role !== "user") setPlanning(false);
    }
    if (ev.type === "task" && ev.chatId === chatId) {
      setData((d) => {
        if (!d) return d;
        const i = d.tasks.findIndex((t) => t.id === ev.task.id);
        const tasks = i < 0 ? [...d.tasks, ev.task] : d.tasks.map((t) => (t.id === ev.task.id ? ev.task : t));
        return { ...d, tasks };
      });
    }
    if (ev.type === "agent" && ev.chatId === chatId && ev.state === "thinking" && ev.detail === "plan") setPlanning(true);
  });

  if (!data) return null;
  const project = projects.find((p) => p.id === data.chat.project_id);
  const active = data.tasks.filter((t) => ["queued", "building", "verifying", "reviewing"].includes(t.status)).length;
  const setTab = (t: string) => go(`chat/${chatId}${t === "chat" ? "" : `?tab=${t}`}`);

  const team = teams.find((t) => t.id === (data.chat.team_id ?? project?.team_id));
  const setTeam = async (teamId: number | null) => {
    await put(`/api/chats/${chatId}`, { team_id: teamId });
    const fresh = await get<ChatData>(`/api/chats/${chatId}`);
    setData((d) => d && { ...d, chat: { ...d.chat, team_id: teamId }, planner_id: fresh.planner_id });
  };
  const planners = agents.filter((a) => a.role === "planner" && a.enabled);
  const setPlanner = async (plannerId: number | null) => {
    await put(`/api/chats/${chatId}`, { planner_id: plannerId });
    const fresh = await get<ChatData>(`/api/chats/${chatId}`);
    setData((d) => d && { ...d, chat: { ...d.chat, planner_id: plannerId }, planner_id: fresh.planner_id });
  };
  const rename = async () => {
    const title = prompt("Chat title", data.chat.title);
    if (!title) return;
    await put(`/api/chats/${chatId}`, { title });
    setData({ ...data, chat: { ...data.chat, title } });
    onChanged();
  };
  const remove = async () => {
    if (!confirm("Delete this chat and its task history? Branches and worktrees stay on disk.")) return;
    await del(`/api/chats/${chatId}`);
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
            : <ChatView data={data} agents={agents} planning={planning} setPlanning={setPlanning} openTasks={() => setTab("tasks")} />}
        </div>
      </div>
    </div>
  );
}

function ChatView({ data, agents, planning, setPlanning, openTasks }: {
  data: ChatData; agents: Agent[]; planning: boolean; setPlanning: (b: boolean) => void; openTasks: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const key = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setFiles((f) => [...f, { key, name: file.name || "pasted image", mime: file.type, size: file.size, preview }]);
      uploadAttachment(data.chat.id, file)
        .then((a) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, id: a.id, name: a.name } : x))))
        .catch((e) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x))));
    }
  };
  const removeFile = (key: string) => setFiles((f) => {
    const x = f.find((y) => y.key === key);
    if (x?.id) del(`/api/attachments/${x.id}`).catch(() => {});
    if (x?.preview) URL.revokeObjectURL(x.preview);
    return f.filter((y) => y.key !== key);
  });
  const uploading = files.some((f) => !f.id && !f.error);
  const caps = useCapabilities(`/api/chats/${data.chat.id}/planner-capabilities?team=${data.chat.team_id ?? ""}&planner=${data.planner_id ?? ""}`);
  const hasImages = files.some((f) => f.mime.startsWith("image/"));
  const ready = files.filter((f) => f.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [data.messages.length, planning]);

  const send = async () => {
    const content = text.trim();
    if ((!content && !ready.length) || planning || uploading) return;
    setError("");
    try {
      await post(`/api/chats/${data.chat.id}/messages`, { content, attachment_ids: ready.map((f) => f.id) });
      setText("");
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
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
        <div className={cn("mx-auto flex max-w-3xl flex-wrap items-end gap-2 rounded-xl border bg-card p-2", dragging && "border-primary ring-3 ring-primary/30")}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}>
          <PendingFiles files={files} onRemove={removeFile} />
          <Button type="button" variant="ghost" size="icon-sm" title="Attach files (or paste / drop them here)" onClick={() => fileInput.current?.click()}>
            <Paperclip />
          </Button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Textarea
            className="min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder={planning ? "The planner is working on it…" : "What should the team do? Paste or drop screenshots and files. (Enter to send, Shift+Enter for a new line)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
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
  useEffect(() => { get<Task[]>(`/api/tasks?ids=${ids.join(",")}`).then(setTasks); }, [ids.join(",")]);
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
