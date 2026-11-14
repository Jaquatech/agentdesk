import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { Plus, Rocket, ShieldCheck, Play, MessageSquare } from "lucide-react";
import { get, post, put, del, useLiveEvents, type Agent, type Task } from "../../api.ts";
import { Field, FooterGap, Modal, StatusBadge, ToneBadge, money } from "../../components/ui.tsx";
import { Choice, NoFillInput } from "../../components/inputs.tsx";
import { TaskDetail } from "../TaskPanel.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type Sprint, type Pi, type Overview, type Preview, type Sel, type Tab, type Group, sprintName, isLive, same, sprintOfTask } from "./model.ts";
import { UsageLine } from "./UsageLine.tsx";

export function PiView({ tab, groups, data, agents, sel, setSel, reload, onNew }: {
  tab: Exclude<Tab, "backlog">; groups: Group[]; data: Overview; agents: Agent[]; sel: Sel | null; setSel: (s: Sel | null) => void; reload: () => void;
  onNew: (kind: "pi" | "sprint", pi?: number) => void;
}) {
  const tasksOf = (s: Sprint) => (tab === "current" && isLive(s) ? data.tasks.filter((t) => t.sprint_id === s.id) : []);
  const entries: Sel[] = groups.flatMap((g) => [
    ...(g.pi ? [{ k: "pi", id: g.pi.id } as Sel] : []),
    ...g.sprints.flatMap((s) => [{ k: "sprint", id: s.id } as Sel, ...tasksOf(s).map((t) => ({ k: "task", id: t.id }) as Sel)]),
  ]);
  const current = entries.find((e) => same(sel, e)) ?? (sel?.k === "task" ? sel : undefined) ?? (tab === "current" ? entries.find((e) => e.k === "task") : undefined) ?? entries[0] ?? null;
  const is = (e: Sel) => same(current, e);
  const sprint = current?.k === "sprint" ? data.sprints.find((s) => s.id === current.id) : undefined;
  const pi = current?.k === "pi" ? data.pis.find((p) => p.id === current.id) : undefined;
  const active = data.pis.filter((p) => p.status === "active");

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(280px,1fr)_minmax(360px,1.2fr)]">
      <div className="overflow-auto border-r">
        {tab !== "releases" && (
          <div className="flex justify-end gap-2 border-b bg-muted px-4 py-2">
            <Button variant="outline" size="sm" onClick={() => onNew("pi")}><Plus data-icon="inline-start" /> New PI</Button>
            <Button size="sm" onClick={() => onNew("sprint")}><Plus data-icon="inline-start" /> New sprint</Button>
          </div>
        )}
        {groups.length === 0 && <Empty className="border-0"><EmptyHeader><EmptyDescription>{{
          coming: "No PI or sprint is planned. A PI groups sprints under one goal. A sprint takes the ready backlog items by priority up to the team's capacity.",
          current: "Nothing is being delivered. Start a sprint from Coming PI.",
          releases: "Nothing is released yet. A sprint is released after its tasks are merged.",
        }[tab]}</EmptyDescription></EmptyHeader></Empty>}
        {groups.map((g) => (
          <div key={g.pi?.id ?? "none"}>
            {g.pi ? (
              <button type="button" className={cn("flex w-full flex-col gap-1 border-b border-l-4 border-l-primary bg-muted px-4 py-3 text-left", is({ k: "pi", id: g.pi.id }) && "bg-accent")} onClick={() => setSel({ k: "pi", id: g.pi!.id })}>
                <div className="flex items-center gap-2"><b>PI: {g.pi.name}</b><ToneBadge tone={g.pi.status === "active" ? "accent" : ""}>{g.pi.status}</ToneBadge></div>
                <div className="truncate text-xs text-muted-foreground">{g.pi.goal || "No goal written"}</div>
              </button>
            ) : active.length > 0 && <div className="border-b bg-muted px-4 py-2 text-sm"><b>Without a PI</b></div>}
            {g.sprints.length === 0 && <p className="px-7 py-2 text-xs text-muted-foreground">No sprint in this PI yet.</p>}
            {g.sprints.map((s) => {
              const tasks = tasksOf(s);
              const merged = data.tasks.filter((t) => t.sprint_id === s.id && t.status === "merged").length;
              const total = data.tasks.filter((t) => t.sprint_id === s.id).length;
              return (
                <div key={s.id}>
                  <button type="button" className={cn("flex w-full flex-col gap-1 border-b px-6 py-3 text-left hover:bg-muted", is({ k: "sprint", id: s.id }) && "bg-accent")} onClick={() => setSel({ k: "sprint", id: s.id })}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{sprintName(s)}</b>
                      <ToneBadge tone={s.status === "active" ? "accent" : s.status === "released" ? "good" : s.status === "done" ? "wait" : ""}>{s.status === "done" ? "complete, not released" : s.status}</ToneBadge>
                      {total > 0 && s.status !== "released" && <ToneBadge>{merged}/{total} merged</ToneBadge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{s.goal || "No goal written"}</div>
                  </button>
                  {tasks.map((t) => (
                    <button key={t.id} type="button" className={cn("flex w-full flex-col gap-1 border-b py-2 pr-4 pl-11 text-left hover:bg-muted", is({ k: "task", id: t.id }) && "bg-accent")} onClick={() => setSel({ k: "task", id: t.id })}>
                      <div className="flex items-center gap-2"><StatusBadge status={t.status} /><span className="ml-auto text-xs text-muted-foreground">{money(t.cost_usd)}</span></div>
                      <b>{t.title}</b>
                      <div className="text-xs text-muted-foreground"><span>{t.worker ?? "no developer"}</span>{t.round > 0 && <span> · round {t.round + 1}</span>}</div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {current?.k === "task" ? <TaskPane key={current.id} id={current.id} agents={agents} onAction={reload} sprint={sprintOfTask(data, current.id)} onBack={(id) => setSel({ k: "sprint", id })} />
        : sprint ? <SprintDetail key={sprint.id} s={sprint} data={data} reload={reload} onTask={(id) => setSel({ k: "task", id })} />
        : pi ? <PiDetail key={pi.id} pi={pi} sprints={data.sprints.filter((s) => s.pi_id === pi.id)} reload={reload} onNewSprint={() => onNew("sprint", pi.id)} />
        : <Empty className="border-0"><EmptyHeader><EmptyDescription>Select a PI or a sprint.</EmptyDescription></EmptyHeader></Empty>}
    </div>
  );
}

export function TaskPane({ id, agents, onAction, sprint, onBack }: { id: number; agents: Agent[]; onAction: () => void; sprint?: Sprint; onBack: (sprintId: number) => void }) {
  const [task, setTask] = useState<Task | null>(null);
  const load = () => get<{ task: Task }>(`/api/tasks/${id}`).then((d) => setTask(d.task));
  useEffect(() => { load(); }, [id]);
  useLiveEvents((ev) => { if (ev.type === "task" && ev.task.id === id) setTask((t) => (t ? { ...t, ...ev.task } : t)); });
  if (!task) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  const name = (aid: number | null) => agents.find((a) => a.id === aid)?.name ?? "–";
  const group = task.status === "merged" ? (sprint?.status === "released" || !sprint ? "released" : "done") : "active";
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-auto">
      <div className="flex items-center gap-3 px-4 pt-2.5">
        {sprint && <Button variant="link" className="h-auto p-0" onClick={() => onBack(sprint.id)}>← Sprint {sprint.number}{sprint.status === "released" ? " release" : ""}</Button>}
        <a className="ml-auto text-xs text-muted-foreground" href={`#/tasks?group=${group}&task=${task.id}`}>Open in Running tasks →</a>
      </div>
      <TaskDetail key={task.id} task={task} name={name} workers={agents.filter((a) => a.role === "worker" && a.enabled)} onAction={() => { load(); onAction(); }} />
    </div>
  );
}

function PiDetail({ pi, sprints, reload, onNewSprint }: { pi: Pi; sprints: Sprint[]; reload: () => void; onNewSprint: () => void }) {
  const withNotes = sprints.filter((s) => s.release_notes).sort((a, b) => a.number - b.number);
  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      <div>
        <div className="flex items-center gap-2"><ToneBadge tone={pi.status === "active" ? "accent" : ""}>{pi.status}</ToneBadge><span className="text-xs text-muted-foreground">program increment</span></div>
        <h2 className="my-1 text-lg font-medium">PI: {pi.name}</h2>
        <div className="markdown">{pi.goal || <span className="text-muted-foreground">No goal written</span>}</div>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Sprints <b className="text-foreground">{sprints.length}</b></span>
        <span>Released <b className="text-foreground">{sprints.filter((s) => s.status === "released").length}</b></span>
      </div>
      <UsageLine u={pi.usage} label="All sprints of this PI" />
      <div className="flex flex-wrap gap-2">
        {pi.status === "active" && <Button variant="outline" onClick={onNewSprint}><Plus data-icon="inline-start" /> New sprint in this PI</Button>}
        <Button variant="outline" onClick={async () => { await put(`/api/pis/${pi.id}`, { status: pi.status === "active" ? "closed" : "active" }); reload(); }}>{pi.status === "active" ? "Close PI" : "Reopen PI"}</Button>
      </div>
      {withNotes.length > 0 && (
        <details open>
          <summary className="cursor-pointer"><b>PI release notes</b></summary>
          <div className="markdown">{withNotes.map((s) => <Markdown key={s.id}>{s.release_notes}</Markdown>)}</div>
        </details>
      )}
    </div>
  );
}

function SprintDetail({ s, data, reload, onTask }: { s: Sprint; data: Overview; reload: () => void; onTask: (id: number) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tasks = data.tasks.filter((t) => t.sprint_id === s.id);
  const merged = tasks.filter((t) => t.status === "merged").length;
  const pi = data.pis.find((p) => p.id === s.pi_id);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={s.status === "active" ? "accent" : s.status === "released" ? "good" : s.status === "done" ? "wait" : ""}>{s.status === "done" ? "complete, not released" : s.status}</ToneBadge>
          {pi && <span className="text-xs text-muted-foreground">PI: {pi.name}</span>}
          {s.branch && <span className="font-mono text-xs text-muted-foreground">{s.branch}</span>}
        </div>
        <h2 className="my-1 text-lg font-medium">{sprintName(s)}</h2>
        <div className="markdown">{s.goal || <span className="text-muted-foreground">No goal written</span>}</div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Tasks <b className="text-foreground">{tasks.length ? `${merged}/${tasks.length} merged` : "none yet"}</b></span>
        {s.capacity > 0 && <span>Capacity <b className="text-foreground">{s.capacity} pts</b></span>}
        {s.released_at && <span>Released <b className="text-foreground">{s.released_at.slice(0, 16).replace("T", " ")}</b></span>}
      </div>
      <UsageLine u={s.usage} />

      {s.status === "active" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => confirm("Close this sprint now? Unfinished items go back to the backlog.") && act(() => post(`/api/sprints/${s.id}/close`))}>Close sprint</Button>
          <span className="text-xs text-muted-foreground">Approved tasks merge into <code>{s.branch}</code>; the base branch stays untouched until Release. Retry stopped tasks from their detail.</span>
        </div>
      )}
      {s.status === "done" && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || s.busy} onClick={() => {
            const warn = s.security_verdict === "issues" ? "The security review found issues. " : !s.security_verdict ? "No security review was run. " : "";
            if (confirm(`${warn}Release sprint ${s.number}? \`${s.branch}\` is merged into the base branch and pushed (when the project has a remote).`)) act(() => post(`/api/sprints/${s.id}/release`));
          }}><Rocket data-icon="inline-start" /> Release to production</Button>
          <Button variant="outline" disabled={busy || s.busy} onClick={() => act(() => post(`/api/sprints/${s.id}/security`))}><ShieldCheck data-icon="inline-start" /> {s.busy ? "Reviewing…" : s.security_verdict ? "Run security review again" : "Security review"}</Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {s.status === "planning" && <PlanPanel s={s} data={data} reload={reload} />}
      {tasks.length > 0 && (
        <div>
          <b>Tasks</b>
          <Card className="mt-1.5 gap-0 py-0">
            {tasks.map((t) => (
              <button key={t.id} type="button" className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted" onClick={() => onTask(t.id)}>
                <span className="min-w-0 flex-1"><b>{t.title}</b><div className="truncate text-xs text-muted-foreground">{t.error || (t.worker ? `${t.worker}${t.round ? ` · round ${t.round + 1}` : ""}` : "no developer")}</div></span>
                <StatusBadge status={t.status} />
              </button>
            ))}
          </Card>
        </div>
      )}
      {(s.status === "done" || s.status === "released") && (
        <>
          <div>
            <b>Release notes</b>
            <Card className="mt-1.5"><CardContent className="markdown">{s.release_notes ? <Markdown>{s.release_notes}</Markdown> : <span className="text-muted-foreground">Writing the release notes…</span>}</CardContent></Card>
          </div>
          <div>
            <b>Security review</b>{" "}
            {s.security_verdict ? <ToneBadge tone={s.security_verdict === "pass" ? "good" : "bad"}>{s.security_verdict === "pass" ? "no blocking findings" : "issues found"}</ToneBadge> : <span className="text-xs text-muted-foreground">(optional)</span>}
            {s.security_report && <Card className="mt-1.5"><CardContent className="markdown"><Markdown>{s.security_report}</Markdown></CardContent></Card>}
          </div>
        </>
      )}
      {s.chat_id && <a className="inline-flex items-center gap-1 text-xs" href={`#/chat/${s.chat_id}`}><MessageSquare /> Sprint chat</a>}
    </div>
  );
}

function PlanPanel({ s, data, reload }: { s: Sprint; data: Overview; reload: () => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = data.sprints.some((x) => x.id !== s.id && ["active", "done"].includes(x.status));
  useEffect(() => {
    get<Preview>(`/api/projects/${data.project.id}/scrum/preview`).then((x) => { setP(x); setPick(new Set(x.selected)); });
  }, [data.project.id, data.items.map((i) => `${i.id}${i.status}${i.priority}${i.points}`).join()]);
  if (!p) return null;
  const used = p.items.filter((i) => pick.has(i.id)).reduce((n, i) => n + (i.points ?? 0), 0);
  const start = async () => {
    setBusy(true); setError("");
    try { await post(`/api/sprints/${s.id}/start`, { item_ids: [...pick] }); reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || blocked || pick.size === 0} onClick={start}><Play data-icon="inline-start" /> Start sprint</Button>
        <Button variant="destructive" onClick={async () => { if (confirm("Delete this planned sprint?")) { await del(`/api/sprints/${s.id}`); reload(); } }}>Delete sprint</Button>
        {blocked && <span className="text-xs text-muted-foreground">Release the running sprint first.</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <b>Plan the sprint</b>
      <p className="text-xs text-muted-foreground">
        Scrum master's plan: ready items by priority, up to {p.capacity} points. <b className={used > p.capacity ? "text-destructive" : undefined}>{used} / {p.capacity}</b> chosen.
      </p>
      {p.items.length === 0 && <Card><CardContent className="text-sm text-muted-foreground">No item is ready. Items become ready after the architect and a developer have refined them.</CardContent></Card>}
      {p.items.map((i) => (
        <label key={i.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm" style={{ opacity: i.too_big ? 0.5 : 1 }}>
          <Checkbox checked={pick.has(i.id)} disabled={i.too_big}
            onCheckedChange={() => setPick((x) => { const n = new Set(x); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })} />
          <span className="min-w-0 flex-1 truncate">{i.title}</span>
          <ToneBadge>{i.points ?? "?"} pts</ToneBadge>{i.too_big && <ToneBadge tone="bad">too big</ToneBadge>}
        </label>
      ))}
    </div>
  );
}

export function NameModal({ kind, projectId, pis, pi: presetPi, onClose, onSaved }: { kind: "pi" | "sprint"; projectId: number; pis: Pi[]; pi?: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [pi, setPi] = useState<number | "">(presetPi ?? pis[0]?.id ?? "");
  const [error, setError] = useState("");
  const save = async () => {
    try {
      if (kind === "pi") await post(`/api/projects/${projectId}/pis`, { name, goal });
      else await post(`/api/projects/${projectId}/sprints`, { name, goal, pi_id: pi || null });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={kind === "pi" ? "New PI (program increment)" : "New sprint"} onClose={onClose}
      footer={<><FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!name.trim()}>Create</Button></>}>
      <Field label="Name"><NoFillInput value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "pi" ? "e.g. PI 1: reporting" : "e.g. Sprint 1"} /></Field>
      <Field label="Goal"><Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should be true when it ends?" /></Field>
      {kind === "sprint" && (
        <Field label="PI (optional)" hint="A PI groups sprints; their release notes and token use add up.">
          <Choice value={pi ? String(pi) : ""} onValueChange={(v) => setPi(v ? Number(v) : "")}
            options={[{ value: "", label: "No PI" }, ...pis.map((p) => ({ value: String(p.id), label: p.name }))]} />
        </Field>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
