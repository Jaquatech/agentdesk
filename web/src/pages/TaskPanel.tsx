import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Check as CheckIcon, Circle, Copy, Download, ExternalLink, GitMerge, RotateCcw, Square, Trash2, X } from "lucide-react";
import { get, post, parseJson, useLiveEvents, type Agent, type Check, type Run, type Task, type TaskChecks } from "../api.ts";
import { StatusBadge, money, ago } from "../components/ui.tsx";
import { TaskActivity } from "../components/Activity.tsx";

const STEPS = ["building", "verifying", "reviewing", "approved", "merged"] as const;
const ACTIVE = ["queued", "building", "verifying", "reviewing"];
const ORDER: Record<string, number> = { building: 0, verifying: 0, reviewing: 0, queued: 1, approved: 2, needs_attention: 2, failed: 2, interrupted: 2, cancelled: 2, proposed: 3 };

/** Tabs in Running tasks. The server decides which task belongs to which (TASK_GROUPS in routes.ts). */
type TaskGroup = "active" | "attention" | "done" | "released" | "archive";
const TABS: { id: TaskGroup; label: string; hint: string }[] = [
  { id: "active", label: "Active", hint: "Queued, building, verifying or in review" },
  { id: "attention", label: "Needs you", hint: "Waiting for you, failed or stopped: run, merge, retry or discard" },
  { id: "done", label: "Done", hint: "Merged into a sprint branch, waiting for the sprint's release" },
  { id: "released", label: "Released", hint: "Merged into the main branch: tasks outside a sprint, and tasks of a released sprint" },
  { id: "archive", label: "Archive", hint: "Cancelled with nothing left to retry (discarded, closed with a sprint)" },
];
const EMPTY: Record<TaskGroup, string> = {
  active: "Nothing is running.",
  attention: "Nothing waiting for you.",
  done: "No task is waiting for its sprint's release.",
  released: "Nothing merged into the main branch yet.",
  archive: "Nothing archived.",
};

/** Task list + detail. With `chatId` only that chat's tasks; without, every task across projects. */
export function TaskPanel({ chatId, agents, initialGroup, initialTask }: { chatId?: number; agents: Agent[]; initialGroup?: string; initialTask?: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<number | null>(initialTask ?? null);
  const [group, setGroup] = useState<TaskGroup>(TABS.some((t) => t.id === initialGroup) ? (initialGroup as TaskGroup) : "active");
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  const load = () => get<Task[]>(`/api/tasks?${chatId ? `chat=${chatId}` : `group=${group}`}`).then(setTasks);
  useEffect(() => { load(); }, [chatId, group]);
  useLiveEvents((ev) => {
    // A sprint release moves its tasks from Done to Released without any task changing status.
    if (ev.type === "scrum" && !chatId) { load(); return; }
    if (ev.type !== "task" || (chatId && ev.chatId !== chatId)) return;
    const known = tasksRef.current.find((t) => t.id === ev.task.id);
    // A chat shows all its tasks, so an event just updates the row. In a tab, a task that is new here or changed
    // status may now belong to another tab: reload the tab instead of guessing which one.
    if (!chatId && (!known || known.status !== ev.task.status)) { load(); return; }
    setTasks((list) => {
      const i = list.findIndex((t) => t.id === ev.task.id);
      if (i < 0) return [{ ...ev.task }, ...list];
      const next = [...list];
      next[i] = { ...next[i], ...ev.task };
      return next;
    });
  });

  const sorted = useMemo(() => [...tasks].sort((a, b) =>
    (ORDER[a.status] ?? 4) - (ORDER[b.status] ?? 4) || b.id - a.id), [tasks]);
  const current = sorted.find((t) => t.id === selected) ?? sorted[0];
  const name = (id: number | null) => agents.find((a) => a.id === id)?.name ?? "–";

  return (
    <div className="tasks">
      <div className="tasks-list">
        {!chatId && (
          <div className="row" style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
            <div className="tabs" style={{ marginLeft: 0 }}>
              {TABS.map((g) => (
                <button key={g.id} className={`tab ${group === g.id ? "active" : ""}`} title={g.hint} onClick={() => setGroup(g.id)}>{g.label}</button>
              ))}
            </div>
          </div>
        )}
        {sorted.length === 0 && <div className="empty">{chatId ? "No tasks yet. Ask the planner for something in a chat." : EMPTY[group]}</div>}
        {sorted.map((t) => (
          <div key={t.id} className={`task-row ${current?.id === t.id ? "active" : ""}`} onClick={() => setSelected(t.id)}>
            <div className="row" style={{ gap: 8 }}>
              <StatusBadge status={t.status} />
              <span className="spacer" />
              <span className="hint">{ago(t.updated_at)}</span>
            </div>
            <b>{t.title}</b>
            <div className="meta">
              <span>{name(t.worker_id)}</span>
              {t.round > 0 && <span>round {t.round + 1}</span>}
              <span>{money(t.cost_usd)}</span>
              {!chatId && t.project_name && <span>{t.project_name} · {t.chat_title}</span>}
            </div>
          </div>
        ))}
      </div>
      {current ? <TaskDetail key={current.id} task={current} name={name} workers={agents.filter((a) => a.role === "worker" && a.enabled)} onAction={load} /> : <div />}
    </div>
  );
}

/** What to show for the checks: before they start (still building, or a new round after a retry) earlier results would mislead. */
function checksView(checks: TaskChecks, waiting: boolean) {
  if (waiting) checks = { run_id: null, running: false, items: checks.items.map((c) => ({ ...c, status: "not_run" as const, exit: null, ms: null, problem: null })) };
  const passed = checks.items.filter((c) => c.status === "passed").length;
  const notRun = checks.items.filter((c) => c.status === "not_run").length;
  const failed = checks.items.some((c) => c.status === "failed");
  const stopped = checks.items.some((c) => c.status === "stopped");
  const summary = waiting ? `${checks.items.length} check${checks.items.length === 1 ? "" : "s"}, run after the build`
    : `${passed} of ${checks.items.length} passed${notRun && !checks.running ? `, ${notRun} not run` : ""}${checks.running ? ", running" : ""}${stopped ? ", stopped" : ""}`;
  const tone = failed ? "bad" : !waiting && passed === checks.items.length ? "good" : "";
  return { checks, summary, tone };
}

/** The project's verify commands, each with its own result; the output of a failed one opens on click. */
function ChecksPanel({ checks: raw, waiting }: { checks: TaskChecks; waiting: boolean }) {
  const { checks, summary, tone } = checksView(raw, waiting);
  return (
    <div className="card card-pad checks" id="task-checks">
      <div className="row" style={{ gap: 8 }}>
        <b>Checks</b>
        <span className={`badge ${tone}`}>{summary}</span>
      </div>
      <div className="check-list">
        {checks.items.map((c) => <CheckRow key={c.step} check={c} runId={checks.run_id} running={checks.running} waiting={waiting} />)}
      </div>
    </div>
  );
}

function CheckRow({ check, runId, running, waiting }: { check: Check; runId: number | null; running: boolean; waiting: boolean }) {
  const [output, setOutput] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const expandable = (check.status === "failed" || check.status === "stopped") && runId !== null;
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && output === null && runId !== null) {
      try {
        const run = await get<{ transcript: { output?: string }[] }>(`/api/runs/${runId}`);
        setOutput(run.transcript[check.step]?.output ?? "(no output saved)");
      } catch (e) { setOutput(`Could not load the output: ${(e as Error).message}`); }
    }
  };
  const result = check.status === "passed" ? "passed" : check.status === "failed" ? `failed${check.exit !== null ? ` (exit ${check.exit})` : ""}` : check.status === "stopped" ? "stopped (you stopped the task)" : running || waiting ? "waiting" : "not run";
  return (
    <div className={`check-row ${check.status}`}>
      <div className="row check-head" style={{ gap: 8 }} onClick={expandable ? toggle : undefined} role={expandable ? "button" : undefined} aria-expanded={expandable ? open : undefined}>
        {check.status === "passed" ? <CheckIcon size={14} className="ok" /> : check.status === "failed" ? <X size={14} className="bad" /> : <Circle size={12} className="dim" />}
        <code className="check-cmd">{check.command}</code>
        <span className="spacer" />
        <span className="hint">{result}{check.ms !== null ? ` · ${check.ms < 1000 ? `${check.ms} ms` : `${(check.ms / 1000).toFixed(1)} s`}` : ""}</span>
        {expandable && <span className="hint">{open ? "hide output" : "show output"}</span>}
      </div>
      {check.problem && (
        <div className="error check-problem">Cannot run here: {check.problem} Fix the command in the <a href="#/projects">project settings</a>; the developer cannot fix this.</div>
      )}
      {open && output !== null && (
        <div className="check-out">
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            <Copy size={13} /> {copied ? "Copied" : "Copy output"}
          </button>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}

export function TaskDetail({ task, name, workers, onAction }: { task: Task; name: (id: number | null) => string; workers: Agent[]; onAction: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const [checks, setChecks] = useState<TaskChecks | null>(null);
  const [waitingFor, setWaitingFor] = useState<{ id: number; title: string; status: string; worker: string } | null>(null);
  const loadRuns = () => get<{ runs: Run[]; checks: TaskChecks; waiting_for: typeof waitingFor }>(`/api/tasks/${task.id}`).then((d) => { setRuns(d.runs); setChecks(d.checks); setWaitingFor(d.waiting_for ?? null); });
  useEffect(() => { loadRuns(); }, [task.id, task.status, task.round]);
  // The task it waits for can stop while this one stays queued: look again when a task of the same chat changes.
  useLiveEvents((e) => { if (e.type === "task" && task.status === "queued" && e.chatId === task.chat_id && e.task.id !== task.id) loadRuns(); });

  const [retryWorker, setRetryWorker] = useState("");
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    if (action === "discard" && !confirm("Delete this task's worktree and branch, here and on the remote (an open pull request closes)?")) return;
    setBusy(action); setError("");
    try { await post(`/api/tasks/${task.id}/${action}`, body); setRetryWorker(""); onAction(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };

  const stepIdx = STEPS.indexOf(task.status as any);
  const failed = ["failed", "needs_attention", "cancelled", "interrupted"].includes(task.status);
  const paths = parseJson<string[]>(task.paths, []);

  return (
    <div className="task-detail">
      <div>
        <div className="row"><StatusBadge status={task.status} /><span className="hint mono">{task.branch || task.slug}</span></div>
        <h2 style={{ margin: "6px 0 10px", fontSize: 18 }}>{task.title}</h2>
        <div className="steps" title="build → checks → review → ready → merged">
          {STEPS.map((s, i) => <div key={s} className={`step ${stepIdx > i || task.status === "merged" ? "done" : stepIdx === i ? "on" : ""} ${failed && i === Math.max(0, stepIdx) ? "fail" : ""}`} />)}
        </div>
      </div>
      {task.status === "queued" && waitingFor && (
        <div className="card card-pad" style={{ borderColor: ["needs_attention", "failed", "interrupted"].includes(waitingFor.status) ? "var(--bad, #c0504d)" : undefined }}>
          Waiting for <b>{waitingFor.title}</b>{waitingFor.worker ? ` (${waitingFor.worker})` : ""} to finish: it changes the same files, so this task starts after it has merged.
          {["needs_attention", "failed", "interrupted"].includes(waitingFor.status) && <> <b>That task has stopped ({waitingFor.status.replace("_", " ")}).</b> Retry or stop it.</>}
        </div>
      )}
      <div className="meta">
        <span>Developer <b>{name(task.worker_id)}</b></span>
        <span>Reviewer <b>{name(task.reviewer_id)}</b></span>
        <span>Round <b>{task.round + 1}</b></span>
        <span>Cost <b>{money(task.cost_usd)}</b></span>
        <span>Tokens <b>{(task.tokens / 1e6).toFixed(2)}M</b></span>
        {task.commit_sha && <span>Commit <b className="mono">{task.commit_sha}</b></span>}
        {checks && checks.items.length > 0 && (() => { const v = checksView(checks, ["proposed", "queued", "building"].includes(task.status)); return (
          <span>Checks <a href="#/tasks" title="Show the checks" onClick={(e) => { e.preventDefault(); document.getElementById("task-checks")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}><b className={v.tone === "bad" ? "bad" : v.tone === "good" ? "ok" : ""}>{v.summary}</b></a></span>
        ); })()}
        {task.sprint_id ? <span>Sprint <a href={`#/scrum/${task.project_id}?tab=${task.sprint_status === "released" ? "releases" : "current"}&sprint=${task.sprint_id}`}><b>{task.sprint_number}</b>{task.sprint_status === "released" ? " · release" : ""} →</a></span> : null}
        {paths.length > 0 && <span>Paths <b className="mono">{paths.join(" ")}</b></span>}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {task.status === "approved" && <button className="btn primary" disabled={!!busy} onClick={() => act("merge")}><GitMerge size={14} /> {busy === "merge" ? "Merging…" : "Merge"}</button>}
        {task.pr_url && <a className="btn" href={task.pr_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Pull request</a>}
        {["queued", "building", "verifying", "reviewing", "proposed"].includes(task.status) && <button className="btn" disabled={!!busy} onClick={() => act("cancel")}><Square size={13} /> Stop</button>}
        {["failed", "needs_attention", "interrupted", "cancelled"].includes(task.status) && (
          <span className="row" style={{ gap: 4 }}>
            <button className="btn" disabled={!!busy} onClick={() => act("retry", retryWorker ? { worker_id: Number(retryWorker) } : {})}><RotateCcw size={14} /> Retry</button>
            <select className="retry-dev" value={retryWorker} onChange={(e) => setRetryWorker(e.target.value)} title="Developer for the retry">
              <option value="">with {name(task.worker_id)}</option>
              {workers.filter((w) => w.id !== task.worker_id).map((w) => <option key={w.id} value={w.id}>with {w.name}</option>)}
            </select>
          </span>
        )}
        <a className="btn" href={`#/chat/${task.chat_id}`}>Open chat</a>
        <a className="btn" href={`/api/tasks/${task.id}/export.md`} download title="Everything about this task and what its agents did, as one Markdown file (to attach to a bug report or hand to a reviewer). It can contain output from your project: read it before you share it."><Download size={14} /> Export</a>
        {["failed", "needs_attention", "cancelled", "interrupted", "approved"].includes(task.status) && task.worktree && <button className="btn danger" disabled={!!busy} onClick={() => act("discard")}><Trash2 size={14} /> Discard branch</button>}
      </div>
      {error && <div className="error">{error}</div>}
      {checks && checks.items.length > 0 && <ChecksPanel checks={checks} waiting={["proposed", "queued", "building"].includes(task.status)} />}
      {task.error && <div className="card card-pad" style={{ borderColor: "var(--bad)" }}><b className="error">Problem</b><div className="msg-body"><Markdown>{task.error}</Markdown></div></div>}
      {task.summary && <details open><summary><b>Developer's summary</b></summary><div className="msg-body"><Markdown>{task.summary}</Markdown></div></details>}
      {task.review && <details open={task.verdict !== "approve"}><summary><b>Review: {task.verdict}</b></summary><div className="msg-body"><Markdown>{task.review}</Markdown></div></details>}
      <details><summary><b>Spec</b></summary><div className="msg-body"><Markdown>{task.spec}</Markdown></div></details>
      <div>
        <b>Activity</b>
        <div style={{ marginTop: 6 }}>
          <TaskActivity taskId={task.id} runs={runs} agentName={name} onNewRun={loadRuns} />
        </div>
      </div>
    </div>
  );
}
