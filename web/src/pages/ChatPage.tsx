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

type ChatData = { chat: Chat; planning: boolean; messages: Message[]; tasks: Task[] };

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
        // The server names a new chat after its first message; mirror that here.
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
    setData({ ...data, chat: { ...data.chat, team_id: teamId } });
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
    <>
      <div className="page-head">
        <span className="crumb">{project?.name}</span>
        <span className="crumb">/</span>
        <h1>{data.chat.title}</h1>
        <button className="icon-btn" title="Rename" onClick={rename}><Pencil size={14} /></button>
        <button className="icon-btn" title="Delete chat" onClick={remove}><Trash2 size={14} /></button>
        {teams.length > 0 && (
          <select className="team-select" title={`Team working on this chat: ${team?.name ?? "every enabled agent"}`}
            value={data.chat.team_id ?? ""} onChange={(e) => setTeam(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{`Team: ${teams.find((t) => t.id === project?.team_id)?.name ?? "all agents"} (project's)`}</option>
            {teams.filter((t) => t.id !== project?.team_id).map((t) => <option key={t.id} value={t.id}>Team: {t.name}</option>)}
          </select>
        )}
        <div className="tabs">
          <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}><MessageSquare size={14} /> Chat</button>
          <button className={`tab ${tab === "tasks" ? "active" : ""}`} onClick={() => setTab("tasks")}><ListChecks size={14} /> Running tasks{active ? ` · ${active}` : ""}</button>
          <button className={`tab ${tab === "office" ? "active" : ""}`} onClick={() => setTab("office")}><Building2 size={14} /> Office</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {project?.process === "scrum" && <ScrumBar projectId={project.id} />}
        <div style={{ flex: 1, minHeight: 0 }}>
          {tab === "tasks" ? <TaskPanel chatId={chatId} agents={agents} />
            : tab === "office" ? <Office chatId={chatId} />
            : <ChatView data={data} agents={agents} planning={planning} setPlanning={setPlanning} openTasks={() => setTab("tasks")} />}
        </div>
      </div>
    </>
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

  // Paste, drop or pick: each file uploads right away and waits in the composer until the message is sent.
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
  // Can the planner see images? Asked once per chat; Ollama reports it per model.
  const caps = useCapabilities(`/api/chats/${data.chat.id}/planner-capabilities?team=${data.chat.team_id ?? ""}`);
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
  const planner = agents.find((a) => a.role === "planner" && a.enabled);

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-inner">
          {data.messages.length === 0 && (
            <div className="empty">
              Describe what you want built or changed. {planner ? <><b>{planner.name}</b> reads the code and proposes tasks.</> : <>Create a planner under <a href="#/agents">Agents</a> first.</>}
            </div>
          )}
          {data.messages.map((m) => {
            const a = agent(m.agent_id);
            const tasks = data.tasks.filter((t) => t.message_id === m.id);
            return (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.role !== "event" && (
                  <div className="msg-who">
                    {a && <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={18} />}
                    {m.role === "user" ? "You" : a?.name ?? "Agent"}
                  </div>
                )}
                {!(m.attachments?.length && m.content === "(see the attached files)") && <div className="msg-body"><Markdown>{m.content}</Markdown></div>}
                {m.attachments?.length ? <MessageFiles files={m.attachments} /> : null}
                {tasks.length > 0 && <PlanCard tasks={tasks} agents={agents} messageId={m.id} onEdit={setEditing} openTasks={openTasks} />}
                {(() => {
                  const plan = parseJson<PlanExtras>(m.plan, {});
                  return <>
                    {plan.merge_ids?.length ? <ActionCard kind="merge" items={plan.merge_ids.map((id) => ({ id }))} agents={agents} /> : null}
                    {plan.retry?.length ? <ActionCard kind="retry" items={plan.retry} agents={agents} /> : null}
                    {plan.journal?.length ? <div className="journal-note"><NotebookPen size={13} /> Noted for later chats: {plan.journal.join(" · ")}</div> : null}
                  </>;
                })()}
              </div>
            );
          })}
          {planning && (
            <div className="msg"><div className="msg-who">{planner?.name ?? "Planner"}</div><span className="typing"><i /><i /><i /></span></div>
          )}
        </div>
      </div>
      <div className="composer">
        {hasImages && caps?.vision === false && (
          <div className="composer-warn">⚠ {caps.agent} runs on <code>{caps.model}</code>, which cannot read images: they are sent as file names only. Use a vision model or Claude for the planner to discuss screenshots.</div>
        )}
        {hasImages && caps && caps.vision === null && caps.agent && (
          <div className="composer-warn">{caps.agent}'s model (<code>{caps.model}</code>) does not say whether it reads images ({caps.source}). If it can't, the reply will ignore them.</div>
        )}
        <div className={`composer-box ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}>
          <PendingFiles files={files} onRemove={removeFile} />
          <button type="button" className="icon-btn attach-btn" title="Attach files (or paste / drop them here)" onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} />
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <textarea
            placeholder={planning ? "The planner is working on it…" : "What should the team do? Paste or drop screenshots and files. (Enter to send, Shift+Enter for a new line)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn primary" onClick={send} disabled={planning || uploading || (!text.trim() && !ready.length)} aria-label="Send"
            title={uploading ? "Waiting for uploads" : undefined}><Send size={15} /></button>
        </div>
        {error && <div className="error" style={{ maxWidth: 820, margin: "6px auto 0" }}>{error}</div>}
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
    <div className="plan">
      {tasks.map((t) => {
        const w = agents.find((a) => a.id === t.worker_id);
        return (
          <div key={t.id} className="plan-row">
            {w ? <Avatar look={lookFor(w.name, parseJson(w.appearance, {}))} size={22} /> : <span style={{ width: 22 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{t.title}</b>
              <div className="hint">{w?.name ?? "any developer"} · <span className="mono">{parseJson<string[]>(t.paths, []).join(" ") || "any path"}</span></div>
            </div>
            <StatusBadge status={t.status} />
            {t.status === "proposed" && <button className="btn small" onClick={() => onEdit(t)}>Edit</button>}
          </div>
        );
      })}
      <div className="plan-foot">
        {proposed.length > 0
          ? <button className="btn primary small" onClick={run} disabled={busy}><Play size={13} /> Run {proposed.length === tasks.length ? "plan" : `${proposed.length} tasks`}</button>
          : <button className="btn small" onClick={openTasks}>Open running tasks</button>}
        <span className="spacer" />
        <span className="hint">{tasks.length} task{tasks.length === 1 ? "" : "s"}{total ? ` · ${money(total)}` : ""}</span>
      </div>
    </div>
  );
}

type PlanExtras = { merge_ids?: number[]; retry?: { id: number; worker_id?: number }[]; journal?: string[] };

/**
 * The planner's "merge these" / "run these again" answer. Tasks may come from other chats of the project,
 * so they are loaded by id and kept live.
 */
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
    <div className="merge-card">
      {tasks.map((t) => {
        const to = items.find((i) => i.id === t.id)?.worker_id;
        return (
          <div key={t.id} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <StatusBadge status={t.status} /><b>{t.title}</b>
            <span className="hint">{to && to !== t.worker_id ? `${name(t.worker_id) ?? "–"} → ${name(to)}` : name(t.worker_id)}</span>
            {t.chat_id !== undefined && <a className="hint" href={`#/chat/${t.chat_id}`}>open chat</a>}
            {results[t.id] && <span className={results[t.id].startsWith("✓") ? "hint" : "error"}>{results[t.id]}</span>}
          </div>
        );
      })}
      <div className="row">
        <button className="btn primary small" disabled={busy || !ready.length} onClick={runAll}>
          {kind === "merge" ? <GitMerge size={13} /> : <RotateCcw size={13} />}{" "}
          {busy ? (kind === "merge" ? "Merging…" : "Queuing…") : ready.length
            ? `${kind === "merge" ? "Merge" : "Run again"}: ${ready.length} task${ready.length === 1 ? "" : "s"}`
            : kind === "merge" ? "Nothing left to merge" : "Nothing left to run"}
        </button>
        <span className="hint">{kind === "merge" ? "Squash-merges into the base branch (GitHub: the pull request)." : "Runs on the same branch; progress under Running tasks."}</span>
      </div>
    </div>
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
    <Modal title="Edit task before it runs" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <div className="grid2">
        <Field label="Developer">
          <select value={worker} onChange={(e) => setWorker(e.target.value)}>
            <option value="">Any free developer</option>
            {agents.filter((a) => a.role === "worker").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Allowed paths (one per line)"><textarea className="mono" rows={2} value={paths} onChange={(e) => setPaths(e.target.value)} /></Field>
      </div>
      <Field label="Spec (Markdown)"><textarea className="mono" rows={16} value={spec} onChange={(e) => setSpec(e.target.value)} /></Field>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

/** Scrum projects: where the cycle is now, so the chat always knows what a new request does. */
function ScrumBar({ projectId }: { projectId: number }) {
  const { data, reload } = useLoad<{ cycle: { text: string } }>(`/api/projects/${projectId}/scrum`);
  useLiveEvents((ev) => { if (ev.type === "scrum" && ev.projectId === projectId) reload(); });
  if (!data) return null;
  return (
    <div className="scrum-bar">
      <b>Scrum</b><span className="ellipsis">{data.cycle.text}</span><span className="spacer" />
      <span className="hint">Ask for anything new; the product manager adds it to the backlog.</span>
      <a href={`#/scrum/${projectId}`}>Backlog & sprints</a>
    </div>
  );
}
