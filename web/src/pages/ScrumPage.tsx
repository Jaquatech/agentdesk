import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { ArrowDown, ArrowUp, Plus, Rocket, ShieldCheck, RotateCcw, Play, MessageSquare, Flag } from "lucide-react";
import { get, post, put, del, useLoad, useLiveEvents, parseJson, type Agent, type Task } from "../api.ts";
import { Field, FooterGap, Modal, StatusBadge, ToneBadge, money } from "../components/ui.tsx";
import { Choice, NoFillInput } from "../components/inputs.tsx";
import { TaskDetail } from "./TaskPanel.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Usage = {
  cost: number; tokens: number; runs: number;
  by_kind: Record<string, { cost: number; tokens: number; runs: number }>; by_model: Record<string, { cost: number; tokens: number; runs: number }>;
};
type Item = {
  id: number; sprint_id: number | null; title: string; request: string; story: string; acceptance: string; tech_notes: string; paths: string;
  worker: string; points: number | null; priority: number; status: "refining" | "ready" | "in_sprint" | "done" | "dropped" | "error";
  step: string; error: string; refining: boolean; cost: number; tokens: number; runs: number;
};
type Sprint = {
  id: number; pi_id: number | null; chat_id: number | null; number: number; name: string; goal: string; status: "planning" | "active" | "done" | "released";
  branch: string; capacity: number; release_notes: string; security_verdict: string; security_report: string; busy: boolean; usage: Usage | null;
  started_at: string | null; released_at: string | null;
};
type Pi = { id: number; name: string; goal: string; status: "active" | "closed"; usage: Usage | null };
type ScrumTask = { id: number; item_id: number | null; sprint_id: number; title: string; status: string; round: number; worker: string | null; cost_usd: number; error: string; chat_id: number };
type Overview = {
  project: { id: number; name: string; process: string; points_per_dev: number };
  cycle: { step: string; text: string; sprint_id: number | null };
  capacity: { developers: number; points_per_dev: number; capacity: number };
  pis: Pi[]; sprints: Sprint[]; items: Item[]; tasks: ScrumTask[]; unplanned: Usage;
};
type Preview = { capacity: number; used: number; items: { id: number; title: string; points: number | null; selected: boolean; too_big: boolean }[]; selected: number[] };

type Sel = { k: "item" | "sprint" | "pi" | "task" | "new"; id: number };
type Tab = "backlog" | "coming" | "current" | "releases";
type Group = { pi: Pi | null; sprints: Sprint[] };

const SIZES = [1, 2, 3, 5, 8, 13];
const KIND: Record<string, string> = { backlog: "product manager", refine: "refinement", build: "development", review: "QA", security: "security review", notes: "release notes", plan: "planning", checks: "checks" };
const STEP: Record<string, string> = { product: "product manager drafting", architect: "architect adding technical notes", estimate: "developer estimating" };
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const sprintName = (s: Sprint) => (/^sprint\b/i.test(s.name) ? s.name : `Sprint ${s.number}: ${s.name}`);
const isLive = (s: Sprint) => s.status === "active" || s.status === "done";
const same = (a: Sel | null, b: Sel) => !!a && a.k === b.k && a.id === b.id;

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "backlog", label: "Backlog", hint: "Items not yet finished, by priority" },
  { id: "coming", label: "Coming PI", hint: "PIs and sprints that are planned but not started" },
  { id: "current", label: "Current PI", hint: "The PI being delivered: its sprints and their tasks" },
  { id: "releases", label: "Releases", hint: "Released sprints with release notes and security review" },
];

function UsageLine({ u, label }: { u: Usage | null; label?: string }) {
  if (!u || !u.runs) return <span className="text-xs text-muted-foreground">{label ? `${label}: ` : ""}no token use yet</span>;
  const kinds = Object.entries(u.by_kind).sort((a, b) => b[1].tokens - a[1].tokens);
  return (
    <span className="text-xs text-muted-foreground" title={kinds.map(([k, v]) => `${KIND[k] ?? k}: ${tokens(v.tokens)} tokens, ${money(v.cost)}`).join("\n")}>
      {label ? `${label}: ` : ""}<b className="text-foreground">{tokens(u.tokens)}</b> tokens · <b className="text-foreground">{money(u.cost)}</b> · {u.runs} calls
      {kinds.length > 0 && <> ({kinds.slice(0, 4).map(([k, v]) => `${KIND[k] ?? k} ${tokens(v.tokens)}`).join(", ")})</>}
    </span>
  );
}

export function ScrumPage({ projectId, initial }: { projectId: number; initial?: { tab?: string; sprint?: number; task?: number } }) {
  const { data, reload } = useLoad<Overview>(`/api/projects/${projectId}/scrum`);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<Tab | null>(TABS.some((t) => t.id === initial?.tab) ? (initial!.tab as Tab) : null);
  const [sel, setSel] = useState<Sel | null>(initial?.task ? { k: "task", id: initial.task } : initial?.sprint ? { k: "sprint", id: initial.sprint } : null);
  const [modal, setModal] = useState<{ kind: "pi" | "sprint"; pi?: number } | null>(null);
  useEffect(() => { get<Agent[]>("/api/agents").then(setAgents); }, []);
  useLiveEvents((ev) => { if ((ev.type === "scrum" && ev.projectId === projectId) || ev.type === "task") reload(); });

  const groups = useMemo(() => (data ? groupsByTab(data) : { coming: [], current: [], releases: [] }), [data]);
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (data.project.process !== "scrum") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-3"><SidebarTrigger /><h1 className="text-sm font-medium">Backlog & PIs</h1></header>
        <div className="p-6"><Card><CardContent>{data.project.name} runs as free chat. Change <b>How work is run</b> to Scrum under <a href="#/projects">Projects</a>.</CardContent></Card></div>
      </div>
    );
  }

  const open = data.items.filter((i) => !["done", "dropped"].includes(i.status));
  const shown: Tab = tab ?? (groups.current.length ? "current" : "backlog");
  const count: Record<Tab, number> = {
    backlog: open.length, coming: groups.coming.length, current: groups.current.reduce((n, g) => n + g.sprints.length, 0),
    releases: data.sprints.filter((s) => s.status === "released").length,
  };
  const pick = (t: Tab) => { setTab(t); setSel(null); };
  const savePoints = async (n: number) => { await put(`/api/projects/${projectId}/scrum/settings`, { points_per_dev: n }); reload(); };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <SidebarTrigger />
        <span className="text-sm text-muted-foreground">{data.project.name}</span>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-sm font-medium">Backlog & PIs</h1>
        <Tabs value={shown} onValueChange={(v) => pick(v as Tab)} className="ml-auto w-auto">
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.id} value={t.id} title={t.hint}>{t.label} · {count[t.id]}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </header>
      <div className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2 text-sm text-primary">
        <Flag />
        <div className="min-w-0 flex-1"><b className="font-medium text-foreground">{data.cycle.text}</b></div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Sprint capacity = developers in the team × points per developer">
          Capacity {data.capacity.capacity} pts = {data.capacity.developers} dev ×
          <Input className="h-7 w-14" type="number" min={1} max={60} defaultValue={data.capacity.points_per_dev}
            onBlur={(e) => { const n = Number(e.target.value); if (n && n !== data.capacity.points_per_dev) savePoints(n); }} />
        </label>
      </div>
      <div className="min-h-0 flex-1">
        {shown === "backlog"
          ? <BacklogView data={data} sel={sel} setSel={setSel} reload={reload} />
          : <PiView key={shown} tab={shown} groups={groups[shown]} data={data} agents={agents} sel={sel} setSel={setSel} reload={reload}
              onNew={(kind, pi) => setModal({ kind, pi })} />}
      </div>
      {modal && <NameModal kind={modal.kind} projectId={projectId} pis={data.pis.filter((p) => p.status === "active")} pi={modal.pi}
        onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); if (modal.kind === "pi") pick("coming"); }} />}
    </div>
  );
}

function groupsByTab(d: Overview): Record<"coming" | "current" | "releases", Group[]> {
  const asc = (a: Sprint, b: Sprint) => a.number - b.number;
  const known = new Set(d.pis.map((p) => p.id));
  const loose = d.sprints.filter((s) => !s.pi_id || !known.has(s.pi_id));
  const coming: Group[] = [], current: Group[] = [], releases: Group[] = [];
  for (const pi of d.pis) {
    const own = d.sprints.filter((s) => s.pi_id === pi.id).sort(asc);
    const where = own.some(isLive) ? "current" : pi.status === "closed" ? "closed" : own.some((s) => s.status === "released") ? "current" : "coming";
    if (where === "current") current.push({ pi, sprints: own });
    else if (where === "coming") coming.push({ pi, sprints: own });
    const rel = own.filter((s) => s.status === "released").sort((a, b) => b.number - a.number);
    if (rel.length) releases.push({ pi, sprints: rel });
  }
  const plan = loose.filter((s) => s.status === "planning").sort(asc);
  const live = loose.filter(isLive).sort(asc);
  const rel = loose.filter((s) => s.status === "released").sort((a, b) => b.number - a.number);
  if (plan.length) coming.push({ pi: null, sprints: plan });
  if (live.length) current.push({ pi: null, sprints: live });
  if (rel.length) releases.push({ pi: null, sprints: rel });
  return { coming, current, releases };
}

function BacklogView({ data, sel, setSel, reload }: { data: Overview; sel: Sel | null; setSel: (s: Sel | null) => void; reload: () => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const open = data.items.filter((i) => !["done", "dropped"].includes(i.status));
  const closed = data.items.filter((i) => ["done", "dropped"].includes(i.status));
  const movable = open.filter((i) => i.status === "ready" || i.status === "refining" || i.status === "error");
  const sprintOf = (i: Item) => data.sprints.find((s) => s.id === i.sprint_id);
  const rows = [...open, ...(showClosed ? closed : [])];
  const current: Sel | null = sel?.k === "new" ? sel : rows.find((i) => sel?.k === "item" && i.id === sel.id) ? sel : rows[0] ? { k: "item", id: rows[0].id } : null;
  const item = current?.k === "item" ? data.items.find((i) => i.id === current.id) : undefined;

  const move = async (i: Item, dir: -1 | 1) => {
    const ids = movable.map((x) => x.id);
    const at = ids.indexOf(i.id), to = at + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    await put(`/api/projects/${data.project.id}/backlog/order`, { ids });
    reload();
  };
  const row = (i: Item) => (
    <div key={i.id} className={cn("grid cursor-pointer grid-cols-[auto_1fr] items-start gap-2 border-b px-4 py-3", same(current, { k: "item", id: i.id }) && "bg-accent")} onClick={() => setSel({ k: "item", id: i.id })}>
      {movable.includes(i) ? (
        <span className="flex flex-col">
          <Button variant="ghost" size="icon-xs" title="Higher priority" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><ArrowUp /></Button>
          <Button variant="ghost" size="icon-xs" title="Lower priority" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><ArrowDown /></Button>
        </span>
      ) : <span className="w-5" />}
      <div className="flex min-w-0 flex-col gap-1">
        <b>{i.title}</b>
        <div className="flex flex-wrap gap-1">
          {i.status === "refining" && <ToneBadge tone="wait">{STEP[i.step] ?? "refining"}…</ToneBadge>}
          {i.status === "ready" && <ToneBadge tone="good">ready</ToneBadge>}
          {i.status === "in_sprint" && <ToneBadge tone="accent">sprint {sprintOf(i)?.number}</ToneBadge>}
          {i.status === "done" && <ToneBadge tone="good">done</ToneBadge>}
          {i.status === "dropped" && <ToneBadge>dropped</ToneBadge>}
          {i.status === "error" && <ToneBadge tone="bad">stopped</ToneBadge>}
          {i.points != null && <ToneBadge title="Story points">{i.points} pts</ToneBadge>}
          {i.worker && <ToneBadge title="Developer the architect suggested">{i.worker}</ToneBadge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{i.error || i.story.replace(/\s+/g, " ") || i.request}</div>
      </div>
    </div>
  );
  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(280px,1fr)_minmax(360px,1.2fr)]">
      <div className="overflow-auto border-r">
        <div className="flex items-center border-b bg-muted px-4 py-2"><b className="text-sm">By priority</b><Button className="ml-auto" size="sm" onClick={() => setSel({ k: "new", id: 0 })}><Plus data-icon="inline-start" /> Add item</Button></div>
        {open.length === 0 && <Empty className="border-0"><EmptyHeader><EmptyTitle>The backlog is empty</EmptyTitle><EmptyDescription>Describe what the business owners need in the project's chat, or add an item here: the product manager writes the story, the architect the technical notes, a developer sizes it.</EmptyDescription></EmptyHeader></Empty>}
        {open.map(row)}
        {closed.length > 0 && (
          <div className="border-b bg-muted px-4 py-2">
            <Button variant="outline" size="sm" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide" : "Show"} done and dropped · {closed.length}</Button>
          </div>
        )}
        {showClosed && closed.map(row)}
        {data.unplanned.runs > 0 && <div className="px-4 py-3"><UsageLine u={data.unplanned} label="Not in any sprint yet (refining items, product manager chat)" /></div>}
      </div>
      {current?.k === "new" ? <NewItem key="new" projectId={data.project.id} onDone={() => { reload(); setSel(null); }} />
        : item ? <ItemEditor key={`${item.id}:${item.status}:${item.step}`} item={item} onChanged={reload} />
        : <Empty className="border-0"><EmptyHeader><EmptyDescription>Select an item.</EmptyDescription></EmptyHeader></Empty>}
    </div>
  );
}

function NewItem({ projectId, onDone }: { projectId: number; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try { await post(`/api/projects/${projectId}/backlog`, { title, description: request }); onDone(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      <h2 className="text-lg font-medium">Add a backlog item</h2>
      <Field label="What is needed"><NoFillInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Export the report as PDF" /></Field>
      <Field label="In the business owner's words" hint="The product manager turns this into a user story with acceptance criteria; then the architect and a developer refine it.">
        <Textarea rows={6} value={request} onChange={(e) => setRequest(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div><Button onClick={save} disabled={!title.trim()}>Add to backlog</Button></div>
    </div>
  );
}

const ITEM_STEPS = ["product", "architect", "estimate", "ready", "in_sprint", "done"] as const;

function ItemEditor({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const locked = ["in_sprint", "done"].includes(item.status);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    title: item.title, story: item.story, acceptance: item.acceptance, tech_notes: item.tech_notes,
    paths: parseJson<string[]>(item.paths, []).join("\n"), points: item.points as number | null,
  });
  const [error, setError] = useState("");
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setError("");
    try { await put(`/api/backlog/${item.id}`, { title: f.title, story: f.story, acceptance: f.acceptance, tech_notes: f.tech_notes, paths: f.paths, points: f.points }); setEditing(false); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  const drop = async () => { await put(`/api/backlog/${item.id}`, { status: "dropped" }); onChanged(); };
  const paths = parseJson<string[]>(item.paths, []);
  const at = item.status === "refining" ? Math.max(0, ITEM_STEPS.indexOf(item.step as typeof ITEM_STEPS[number])) : item.status === "ready" ? 3 : item.status === "in_sprint" ? 4 : item.status === "done" ? 5 : -1;
  const label = item.status === "in_sprint" ? "in sprint" : item.status === "error" ? "stopped" : item.status === "refining" ? (STEP[item.step] ?? "refining") : item.status;

  if (editing) {
    return (
      <div className="flex flex-col gap-4 overflow-auto p-5">
        <h2 className="text-lg font-medium">Edit item</h2>
        <Field label="Title"><NoFillInput value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="User story (product manager)"><Textarea rows={5} value={f.story} onChange={(e) => set("story", e.target.value)} /></Field>
        <Field label="Acceptance criteria"><Textarea rows={6} value={f.acceptance} onChange={(e) => set("acceptance", e.target.value)} /></Field>
        <Field label="Technical notes (architect)"><Textarea className="font-mono text-xs" rows={10} value={f.tech_notes} onChange={(e) => set("tech_notes", e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Files it may change (one per line)"><Textarea className="font-mono text-xs" rows={3} value={f.paths} onChange={(e) => set("paths", e.target.value)} /></Field>
          <Field label="Size (story points)" hint="Set by a developer; change it if you know better. 13 means too big: split it.">
            <Choice value={f.points != null ? String(f.points) : ""} onValueChange={(v) => set("points", v ? Number(v) : null)}
              options={[{ value: "", label: "Not estimated" }, ...SIZES.map((s) => ({ value: String(s), label: String(s) }))]} />
          </Field>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setEditing(false); setError(""); }}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      <div>
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 text-xs capitalize", item.status === "ready" || item.status === "done" ? "text-success" : item.status === "error" ? "text-destructive" : item.status === "refining" ? "text-primary" : "text-muted-foreground")}>
            <span className={cn("size-2 rounded-full bg-current", item.status === "refining" && "animate-pulse")} />
            {label}
          </span>
          <span className="text-xs text-muted-foreground">backlog item #{item.id}</span>
        </div>
        <h2 className="my-1.5 text-lg font-medium">{item.title}</h2>
        <div className="flex gap-1" title="product manager → architect → estimate → ready → in sprint → done">
          {ITEM_STEPS.map((s, i) => <div key={s} className={cn("h-1 flex-1 rounded-full bg-border", (at > i || (at === i && item.status !== "refining")) && "bg-success", at === i && item.status === "refining" && "bg-primary", item.status === "error" && i === Math.max(0, ITEM_STEPS.indexOf(item.step as typeof ITEM_STEPS[number])) && "bg-destructive")} />)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        <span>Developer <b className="text-foreground">{item.worker || "–"}</b></span>
        <span>Size <b className="text-foreground">{item.points != null ? `${item.points} pts` : "not estimated"}</b></span>
        <span>Cost <b className="text-foreground">{money(item.cost)}</b></span>
        <span>Tokens <b className="text-foreground">{(item.tokens / 1e6).toFixed(2)}M</b></span>
        <span>Calls <b className="text-foreground">{item.runs}</b></span>
        {paths.length > 0 && <span>Paths <b className="font-mono text-foreground">{paths.join(" ")}</b></span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!locked && item.status !== "dropped" && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
        {item.status === "error" && <Button variant="outline" onClick={async () => { await post(`/api/backlog/${item.id}/retry`); onChanged(); }}><RotateCcw data-icon="inline-start" /> Retry</Button>}
        {!locked && item.status !== "dropped" && <Button variant="destructive" onClick={drop}>Drop item</Button>}
      </div>
      {locked && <p className="text-xs text-muted-foreground">This item is in a sprint or done: its text is fixed. Follow it under Current PI.</p>}
      {item.error && <Card className="ring-destructive"><CardContent><b className="text-destructive">Problem</b><div className="markdown"><Markdown>{item.error}</Markdown></div></CardContent></Card>}
      {item.story && <details open><summary className="cursor-pointer"><b>User story</b></summary><div className="markdown"><Markdown>{item.story}</Markdown></div></details>}
      {item.acceptance && <details open><summary className="cursor-pointer"><b>Acceptance criteria</b></summary><div className="markdown"><Markdown>{item.acceptance}</Markdown></div></details>}
      {item.tech_notes && <details open><summary className="cursor-pointer"><b>Technical notes</b></summary><div className="markdown"><Markdown>{item.tech_notes}</Markdown></div></details>}
      {item.request && <details><summary className="cursor-pointer"><b>In the business owner's words</b></summary><div className="markdown"><Markdown>{item.request}</Markdown></div></details>}
    </div>
  );
}

function PiView({ tab, groups, data, agents, sel, setSel, reload, onNew }: {
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

function sprintOfTask(d: Overview, taskId: number): Sprint | undefined {
  const sid = d.tasks.find((t) => t.id === taskId)?.sprint_id;
  return d.sprints.find((s) => s.id === sid);
}

function TaskPane({ id, agents, onAction, sprint, onBack }: { id: number; agents: Agent[]; onAction: () => void; sprint?: Sprint; onBack: (sprintId: number) => void }) {
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
        {sprint && <a href="#" onClick={(e) => { e.preventDefault(); onBack(sprint.id); }}>← Sprint {sprint.number}{sprint.status === "released" ? " release" : ""}</a>}
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

function NameModal({ kind, projectId, pis, pi: presetPi, onClose, onSaved }: { kind: "pi" | "sprint"; projectId: number; pis: Pi[]; pi?: number; onClose: () => void; onSaved: () => void }) {
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
