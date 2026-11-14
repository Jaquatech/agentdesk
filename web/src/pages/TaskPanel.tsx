import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Check as CheckIcon, Circle, Copy, Download, ExternalLink, GitMerge, RotateCcw, Square, Trash2, X } from "lucide-react";
import { get, post, parseJson, useLiveEvents, type Agent, type Check, type Run, type Task, type TaskChecks } from "../api.ts";
import { StatusBadge, ToneBadge, money, ago } from "../components/ui.tsx";
import { TaskActivity } from "../components/Activity.tsx";
import { Choice } from "../components/inputs.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const STEPS = ["building", "verifying", "reviewing", "approved", "merged"] as const;
const ORDER: Record<string, number> = { building: 0, verifying: 0, reviewing: 0, queued: 1, approved: 2, needs_attention: 2, failed: 2, interrupted: 2, cancelled: 2, proposed: 3 };

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
    if (ev.type === "scrum" && !chatId) { load(); return; }
    if (ev.type !== "task" || (chatId && ev.chatId !== chatId)) return;
    const known = tasksRef.current.find((t) => t.id === ev.task.id);
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
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(280px,1fr)_minmax(360px,1.2fr)]">
      <div className="overflow-auto border-r">
        {!chatId && (
          <div className="border-b p-2">
            <Tabs value={group} onValueChange={(v) => setGroup(v as TaskGroup)}>
              <TabsList className="flex h-auto w-full flex-wrap">
                {TABS.map((g) => <TabsTrigger key={g.id} value={g.id} title={g.hint}>{g.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          </div>
        )}
        {sorted.length === 0 && (
          <Empty className="border-0">
            <EmptyHeader><EmptyTitle>No tasks</EmptyTitle><EmptyDescription>{chatId ? "No tasks yet. Ask the planner for something in a chat." : EMPTY[group]}</EmptyDescription></EmptyHeader>
          </Empty>
        )}
        {sorted.map((t) => (
          <button key={t.id} type="button" onClick={() => setSelected(t.id)} className={cn("flex w-full flex-col gap-1 border-b px-4 py-3 text-left hover:bg-muted", current?.id === t.id && "bg-accent")}>
            <div className="flex items-center gap-2">
              <StatusBadge status={t.status} />
              <span className="ml-auto text-xs text-muted-foreground">{ago(t.updated_at)}</span>
            </div>
            <b>{t.title}</b>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>{name(t.worker_id)}</span>
              {t.round > 0 && <span>round {t.round + 1}</span>}
              <span>{money(t.cost_usd)}</span>
              {!chatId && t.project_name && <span>{t.project_name} · {t.chat_title}</span>}
            </div>
          </button>
        ))}
      </div>
      {current ? <TaskDetail key={current.id} task={current} name={name} workers={agents.filter((a) => a.role === "worker" && a.enabled)} onAction={load} /> : <div />}
    </div>
  );
}

function checksView(checks: TaskChecks, waiting: boolean) {
  if (waiting) checks = { run_id: null, running: false, items: checks.items.map((c) => ({ ...c, status: "not_run" as const, exit: null, ms: null, problem: null })) };
  const passed = checks.items.filter((c) => c.status === "passed").length;
  const notRun = checks.items.filter((c) => c.status === "not_run").length;
  const failed = checks.items.some((c) => c.status === "failed");
  const stopped = checks.items.some((c) => c.status === "stopped");
  const summary = waiting ? `${checks.items.length} check${checks.items.length === 1 ? "" : "s"}, run after the build`
    : `${passed} of ${checks.items.length} passed${notRun && !checks.running ? `, ${notRun} not run` : ""}${checks.running ? ", running" : ""}${stopped ? ", stopped" : ""}`;
  const tone = failed ? "bad" : !waiting && passed === checks.items.length ? "good" : "";
  return { checks, summary, tone: tone as "bad" | "good" | "" };
}

function ChecksPanel({ checks: raw, waiting }: { checks: TaskChecks; waiting: boolean }) {
  const { checks, summary, tone } = checksView(raw, waiting);
  return (
    <Card id="task-checks" className="shrink-0">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <b>Checks</b>
          <ToneBadge tone={tone}>{summary}</ToneBadge>
        </div>
        <div>
          {checks.items.map((c) => <CheckRow key={c.step} check={c} runId={checks.run_id} running={checks.running} waiting={waiting} />)}
        </div>
      </CardContent>
    </Card>
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
    <div className="border-t py-1.5 first:border-t-0">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the role is set whenever the row can expand */}
      <div className={cn("flex items-center gap-2", expandable && "cursor-pointer")} onClick={expandable ? toggle : undefined} onKeyDown={expandable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined} tabIndex={expandable ? 0 : undefined} role={expandable ? "button" : undefined} aria-expanded={expandable ? open : undefined}>
        {check.status === "passed" ? <CheckIcon className="text-success" /> : check.status === "failed" ? <X className="text-destructive" /> : <Circle className="text-muted-foreground" />}
        <code className="min-w-0 truncate font-mono text-xs">{check.command}</code>
        <span className="ml-auto text-xs text-muted-foreground">{result}{check.ms !== null ? ` · ${check.ms < 1000 ? `${check.ms} ms` : `${(check.ms / 1000).toFixed(1)} s`}` : ""}</span>
        {expandable && <span className="text-xs text-muted-foreground">{open ? "hide output" : "show output"}</span>}
      </div>
      {check.problem && (
        <p className="mt-1 ml-6 text-sm text-destructive">Cannot run here: {check.problem} Fix the command in the <a href="#/projects">project settings</a>; the developer cannot fix this.</p>
      )}
      {open && output !== null && (
        <div className="mt-2 flex flex-col items-start gap-2">
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            <Copy data-icon="inline-start" /> {copied ? "Copied" : "Copy output"}
          </Button>
          <pre className="max-h-80 w-full overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{output}</pre>
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
  useLiveEvents((e) => { if (e.type === "task" && task.status === "queued" && e.chatId === task.chat_id && e.task.id !== task.id) loadRuns(); });

  const [retryWorker, setRetryWorker] = useState("");
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    if (action === "discard" && !confirm("Delete this task's worktree and branch, here and on the remote (an open pull request closes)?")) return;
    setBusy(action); setError("");
    try { await post(`/api/tasks/${task.id}/${action}`, body); setRetryWorker(""); onAction(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };

  const stepIdx = STEPS.indexOf(task.status as typeof STEPS[number]);
  const failed = ["failed", "needs_attention", "cancelled", "interrupted"].includes(task.status);
  const paths = parseJson<string[]>(task.paths, []);
  const stoppedWait = waitingFor && ["needs_attention", "failed", "interrupted"].includes(waitingFor.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5 [&>*]:shrink-0">
      <div>
        <div className="flex items-center gap-2"><StatusBadge status={task.status} /><span className="font-mono text-xs text-muted-foreground">{task.branch || task.slug}</span></div>
        <h2 className="my-1.5 text-lg font-medium">{task.title}</h2>
        <div className="flex gap-1" title="build → checks → review → ready → merged">
          {STEPS.map((s, i) => <div key={s} className={cn("h-1 flex-1 rounded-full bg-border", (stepIdx > i || task.status === "merged") && "bg-success", stepIdx === i && "bg-primary", failed && i === Math.max(0, stepIdx) && "bg-destructive")} />)}
        </div>
      </div>
      {task.status === "queued" && waitingFor && (
        <Card className={cn(stoppedWait && "ring-destructive")}>
          <CardContent>
            Waiting for <b>{waitingFor.title}</b>{waitingFor.worker ? ` (${waitingFor.worker})` : ""} to finish: it changes the same files, so this task starts after it has merged.
            {stoppedWait && <> <b>That task has stopped ({waitingFor.status.replace("_", " ")}).</b> Retry or stop it.</>}
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Developer <b className="font-medium text-foreground">{name(task.worker_id)}</b></span>
        <span>Reviewer <b className="font-medium text-foreground">{name(task.reviewer_id)}</b></span>
        <span>Round <b className="font-medium text-foreground">{task.round + 1}</b></span>
        <span>Cost <b className="font-medium text-foreground">{money(task.cost_usd)}</b></span>
        <span>Tokens <b className="font-medium text-foreground">{(task.tokens / 1e6).toFixed(2)}M</b></span>
        {task.commit_sha && <span>Commit <b className="font-mono font-medium text-foreground">{task.commit_sha}</b></span>}
        {checks && checks.items.length > 0 && (() => { const v = checksView(checks, ["proposed", "queued", "building"].includes(task.status)); return (
          <span>Checks <a href="#/tasks" title="Show the checks" onClick={(e) => { e.preventDefault(); document.getElementById("task-checks")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}><b className={v.tone === "bad" ? "text-destructive" : v.tone === "good" ? "text-success" : "text-foreground"}>{v.summary}</b></a></span>
        ); })()}
        {task.sprint_id ? <span>Sprint <a href={`#/scrum/${task.project_id}?tab=${task.sprint_status === "released" ? "releases" : "current"}&sprint=${task.sprint_id}`}><b>{task.sprint_number}</b>{task.sprint_status === "released" ? " · release" : ""} →</a></span> : null}
        {task.document_id ? <span>Wiki <a href={`#/documents/${task.document_id}`}><b>{task.title}</b> →</a></span> : null}
        {paths.length > 0 && <span>Paths <b className="font-mono font-medium text-foreground">{paths.join(" ")}</b></span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {task.status === "approved" && <Button disabled={!!busy} onClick={() => act("merge")}><GitMerge data-icon="inline-start" /> {busy === "merge" ? "Merging…" : "Merge"}</Button>}
        {task.pr_url && <Button variant="outline" asChild><a href={task.pr_url} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" /> Pull request</a></Button>}
        {["queued", "building", "verifying", "reviewing", "proposed"].includes(task.status) && <Button variant="outline" disabled={!!busy} onClick={() => act("cancel")}><Square data-icon="inline-start" /> Stop</Button>}
        {["failed", "needs_attention", "interrupted", "cancelled"].includes(task.status) && (
          <span className="flex items-center gap-1">
            <Button variant="outline" disabled={!!busy} onClick={() => act("retry", retryWorker ? { worker_id: Number(retryWorker) } : {})}><RotateCcw data-icon="inline-start" /> Retry</Button>
            <Choice size="sm" className="w-auto" value={retryWorker} onValueChange={setRetryWorker} title="Developer for the retry"
              options={[{ value: "", label: `with ${name(task.worker_id)}` }, ...workers.filter((w) => w.id !== task.worker_id).map((w) => ({ value: String(w.id), label: `with ${w.name}` }))]} />
          </span>
        )}
        <Button variant="outline" asChild><a href={`#/chat/${task.chat_id}`}>Open chat</a></Button>
        <Button variant="outline" asChild><a href={`/api/tasks/${task.id}/export.md`} download title="Everything about this task and what its agents did, as one Markdown file (to attach to a bug report or hand to a reviewer). It can contain output from your project: read it before you share it."><Download data-icon="inline-start" /> Export</a></Button>
        {["failed", "needs_attention", "cancelled", "interrupted", "approved"].includes(task.status) && task.worktree && <Button variant="destructive" disabled={!!busy} onClick={() => act("discard")}><Trash2 data-icon="inline-start" /> Discard branch</Button>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {checks && checks.items.length > 0 && <ChecksPanel checks={checks} waiting={["proposed", "queued", "building"].includes(task.status)} />}
      {task.error && <Card className="ring-destructive"><CardContent><b className="text-destructive">Problem</b><div className="markdown"><Markdown>{task.error}</Markdown></div></CardContent></Card>}
      {task.summary && <details open><summary className="cursor-pointer"><b>Developer's summary</b></summary><div className="markdown"><Markdown>{task.summary}</Markdown></div></details>}
      {task.review && <details open={task.verdict !== "approve"}><summary className="cursor-pointer"><b>Review: {task.verdict}</b></summary><div className="markdown"><Markdown>{task.review}</Markdown></div></details>}
      <details><summary className="cursor-pointer"><b>Spec</b></summary><div className="markdown"><Markdown>{task.spec}</Markdown></div></details>
      <div>
        <b>Activity</b>
        <div className="mt-2">
          <TaskActivity taskId={task.id} runs={runs} agentName={name} onNewRun={loadRuns} />
        </div>
      </div>
    </div>
  );
}
