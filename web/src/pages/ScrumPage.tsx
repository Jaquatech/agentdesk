import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { ArrowDown, ArrowUp, Plus, Rocket, ShieldCheck, RotateCcw, Play, MessageSquare, Flag } from "lucide-react";
import { get, post, put, del, useLoad, useLiveEvents, parseJson, type Agent, type Task } from "../api.ts";
import { Field, Modal, StatusBadge, money } from "../components/ui.tsx";
import { NoFillInput } from "../components/inputs.tsx";
import { TaskDetail } from "./TaskPanel.tsx";

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

/** What is selected in the list: its detail shows on the right. */
type Sel = { k: "item" | "sprint" | "pi" | "task" | "new"; id: number };
type Tab = "backlog" | "coming" | "current" | "releases";
/** A PI (or sprints without one) with the sprints shown under it in a tab. */
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

/** Tokens and cost, with what they were spent on. */
function UsageLine({ u, label }: { u: Usage | null; label?: string }) {
  if (!u || !u.runs) return <span className="hint">{label ? `${label}: ` : ""}no token use yet</span>;
  const kinds = Object.entries(u.by_kind).sort((a, b) => b[1].tokens - a[1].tokens);
  return (
    <span className="hint" title={kinds.map(([k, v]) => `${KIND[k] ?? k}: ${tokens(v.tokens)} tokens, ${money(v.cost)}`).join("\n")}>
      {label ? `${label}: ` : ""}<b>{tokens(u.tokens)}</b> tokens · <b>{money(u.cost)}</b> · {u.runs} calls
      {kinds.length > 0 && <> ({kinds.slice(0, 4).map(([k, v]) => `${KIND[k] ?? k} ${tokens(v.tokens)}`).join(", ")})</>}
    </span>
  );
}

/**
 * Backlog, PIs and releases of a Scrum project, laid out like Running tasks: a list on the left, the selected thing on the right.
 * Which PI is "coming" or "current" is worked out from its sprints (nothing started yet = coming).
 */
export function ScrumPage({ projectId }: { projectId: number }) {
  const { data, reload } = useLoad<Overview>(`/api/projects/${projectId}/scrum`);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [modal, setModal] = useState<{ kind: "pi" | "sprint"; pi?: number } | null>(null);
  useEffect(() => { get<Agent[]>("/api/agents").then(setAgents); }, []);
  useLiveEvents((ev) => { if ((ev.type === "scrum" && ev.projectId === projectId) || ev.type === "task") reload(); });

  const groups = useMemo(() => (data ? groupsByTab(data) : { coming: [], current: [], releases: [] }), [data]);
  if (!data) return <div className="page"><div className="narrow hint">Loading…</div></div>;
  if (data.project.process !== "scrum") {
    return <><div className="page-head"><h1>Backlog & PIs</h1></div><div className="page"><div className="narrow card card-pad">
      {data.project.name} runs as free chat. Change <b>How work is run</b> to Scrum under <a href="#/projects">Projects</a>.
    </div></div></>;
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
    <>
      <div className="page-head">
        <span className="crumb">{data.project.name}</span><span className="crumb">/</span><h1>Backlog & PIs</h1>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${shown === t.id ? "active" : ""}`} title={t.hint} onClick={() => pick(t.id)}>{t.label} · {count[t.id]}</button>
          ))}
        </div>
      </div>
      <div className="scrum-step">
        <Flag size={15} /> <div style={{ flex: 1, minWidth: 0 }}><b>{data.cycle.text}</b></div>
        <label className="hint row" style={{ gap: 6 }} title="Sprint capacity = developers in the team × points per developer">
          Capacity {data.capacity.capacity} pts = {data.capacity.developers} dev × <NoFillInput type="number" min={1} max={60} defaultValue={data.capacity.points_per_dev} style={{ width: 56 }}
            onBlur={(e) => { const n = Number(e.target.value); if (n && n !== data.capacity.points_per_dev) savePoints(n); }} />
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {shown === "backlog"
          ? <BacklogView data={data} sel={sel} setSel={setSel} reload={reload} />
          : <PiView key={shown} tab={shown} groups={groups[shown]} data={data} agents={agents} sel={sel} setSel={setSel} reload={reload}
              onNew={(kind, pi) => setModal({ kind, pi })} />}
      </div>
      {modal && <NameModal kind={modal.kind} projectId={projectId} pis={data.pis.filter((p) => p.status === "active")} pi={modal.pi}
        onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); if (modal.kind === "pi") pick("coming"); }} />}
    </>
  );
}

/** Which PIs and sprints each tab shows. */
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

// ---------- backlog ----------

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
    <div key={i.id} className={`task-row item-row ${same(current, { k: "item", id: i.id }) ? "active" : ""}`} onClick={() => setSel({ k: "item", id: i.id })}>
      {movable.includes(i) ? (
        <span className="col">
          <button className="icon-btn" title="Higher priority" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><ArrowUp size={13} /></button>
          <button className="icon-btn" title="Lower priority" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><ArrowDown size={13} /></button>
        </span>
      ) : <span style={{ width: 20 }} />}
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <b>{i.title}</b>
        <div className="meta">
          {i.status === "refining" && <span className="badge wait">{STEP[i.step] ?? "refining"}…</span>}
          {i.status === "ready" && <span className="badge good">ready</span>}
          {i.status === "in_sprint" && <span className="badge accent">sprint {sprintOf(i)?.number}</span>}
          {i.status === "done" && <span className="badge good">done</span>}
          {i.status === "dropped" && <span className="badge">dropped</span>}
          {i.status === "error" && <span className="badge bad">stopped</span>}
          {i.points != null && <span className="badge" title="Story points">{i.points} pts</span>}
          {i.worker && <span className="badge" title="Developer the architect suggested">{i.worker}</span>}
        </div>
        <div className="hint ellipsis">{i.error || i.story.replace(/\s+/g, " ") || i.request}</div>
      </div>
    </div>
  );
  return (
    <div className="tasks">
      <div className="tasks-list">
        <div className="list-bar"><b>By priority</b><span className="spacer" />
          <button className="btn small primary" onClick={() => setSel({ k: "new", id: 0 })}><Plus size={13} /> Add item</button></div>
        {open.length === 0 && <div className="empty">The backlog is empty. Describe what the business owners need in the project's chat, or add an item here: the product manager writes the story, the architect the technical notes, a developer sizes it.</div>}
        {open.map(row)}
        {closed.length > 0 && (
          <div className="list-bar">
            <button className="btn small" onClick={() => setShowClosed(!showClosed)}>{showClosed ? "Hide" : "Show"} done and dropped · {closed.length}</button>
          </div>
        )}
        {showClosed && closed.map(row)}
        {data.unplanned.runs > 0 && <div style={{ padding: "12px 16px" }}><UsageLine u={data.unplanned} label="Not in any sprint yet (refining items, product manager chat)" /></div>}
      </div>
      {current?.k === "new" ? <NewItem key="new" projectId={data.project.id} onDone={() => { reload(); setSel(null); }} />
        : item ? <ItemEditor key={`${item.id}:${item.status}:${item.step}`} item={item} onChanged={reload} />
        : <div className="empty">Select an item.</div>}
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
    <div className="task-detail">
      <h2 style={{ margin: 0, fontSize: 18 }}>Add a backlog item</h2>
      <Field label="What is needed"><NoFillInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Export the report as PDF" /></Field>
      <Field label="In the business owner's words" hint="The product manager turns this into a user story with acceptance criteria; then the architect and a developer refine it.">
        <textarea rows={6} value={request} onChange={(e) => setRequest(e.target.value)} />
      </Field>
      {error && <div className="error">{error}</div>}
      <div className="row"><button className="btn primary" onClick={save} disabled={!title.trim()}>Add to backlog</button></div>
    </div>
  );
}

const ITEM_STEPS = ["product", "architect", "estimate", "ready", "in_sprint", "done"] as const;

/** An item looks like a task: status, steps, who/size/cost, rendered text. Edit opens the form. */
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
  const at = item.status === "refining" ? Math.max(0, ITEM_STEPS.indexOf(item.step as any)) : item.status === "ready" ? 3 : item.status === "in_sprint" ? 4 : item.status === "done" ? 5 : -1;
  const label = item.status === "in_sprint" ? "in sprint" : item.status === "error" ? "stopped" : item.status === "refining" ? (STEP[item.step] ?? "refining") : item.status;
  const tone = item.status === "ready" || item.status === "done" ? "s-approved" : item.status === "error" ? "s-failed" : item.status === "refining" ? "s-building" : "s-queued";

  if (editing) {
    return (
      <div className="task-detail">
        <h2 style={{ margin: 0, fontSize: 18 }}>Edit item</h2>
        <Field label="Title"><NoFillInput value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="User story (product manager)"><textarea rows={5} value={f.story} onChange={(e) => set("story", e.target.value)} /></Field>
        <Field label="Acceptance criteria"><textarea rows={6} value={f.acceptance} onChange={(e) => set("acceptance", e.target.value)} /></Field>
        <Field label="Technical notes (architect)"><textarea className="mono" rows={10} value={f.tech_notes} onChange={(e) => set("tech_notes", e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Files it may change (one per line)"><textarea className="mono" rows={3} value={f.paths} onChange={(e) => set("paths", e.target.value)} /></Field>
          <Field label="Size (story points)" hint="Set by a developer; change it if you know better. 13 means too big: split it.">
            <select value={f.points ?? ""} onChange={(e) => set("points", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not estimated</option>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row"><span className="spacer" />
          <button className="btn" onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button></div>
      </div>
    );
  }
  return (
    <div className="task-detail">
      <div>
        <div className="row"><span className={`status ${tone}`}>{label}</span><span className="hint">backlog item #{item.id}</span></div>
        <h2 style={{ margin: "6px 0 10px", fontSize: 18 }}>{item.title}</h2>
        <div className="steps" title="product manager → architect → estimate → ready → in sprint → done">
          {ITEM_STEPS.map((s, i) => <div key={s} className={`step ${at > i ? "done" : at === i ? (item.status === "refining" ? "on" : "done") : ""} ${item.status === "error" && i === Math.max(0, ITEM_STEPS.indexOf(item.step as any)) ? "fail" : ""}`} />)}
        </div>
      </div>
      <div className="meta">
        <span>Developer <b>{item.worker || "–"}</b></span>
        <span>Size <b>{item.points != null ? `${item.points} pts` : "not estimated"}</b></span>
        <span>Cost <b>{money(item.cost)}</b></span>
        <span>Tokens <b>{(item.tokens / 1e6).toFixed(2)}M</b></span>
        <span>Calls <b>{item.runs}</b></span>
        {paths.length > 0 && <span>Paths <b className="mono">{paths.join(" ")}</b></span>}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {!locked && item.status !== "dropped" && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
        {item.status === "error" && <button className="btn" onClick={async () => { await post(`/api/backlog/${item.id}/retry`); onChanged(); }}><RotateCcw size={14} /> Retry</button>}
        {!locked && item.status !== "dropped" && <button className="btn danger" onClick={drop}>Drop item</button>}
      </div>
      {locked && <div className="hint">This item is in a sprint or done: its text is fixed. Follow it under Current PI.</div>}
      {item.error && <div className="card card-pad" style={{ borderColor: "var(--bad)" }}><b className="error">Problem</b><div className="msg-body"><Markdown>{item.error}</Markdown></div></div>}
      {item.story && <details open><summary><b>User story</b></summary><div className="msg-body"><Markdown>{item.story}</Markdown></div></details>}
      {item.acceptance && <details open><summary><b>Acceptance criteria</b></summary><div className="msg-body"><Markdown>{item.acceptance}</Markdown></div></details>}
      {item.tech_notes && <details open><summary><b>Technical notes</b></summary><div className="msg-body"><Markdown>{item.tech_notes}</Markdown></div></details>}
      {item.request && <details><summary><b>In the business owner's words</b></summary><div className="msg-body"><Markdown>{item.request}</Markdown></div></details>}
    </div>
  );
}

// ---------- coming PI, current PI, releases ----------

function PiView({ tab, groups, data, agents, sel, setSel, reload, onNew }: {
  tab: Exclude<Tab, "backlog">; groups: Group[]; data: Overview; agents: Agent[]; sel: Sel | null; setSel: (s: Sel | null) => void; reload: () => void;
  onNew: (kind: "pi" | "sprint", pi?: number) => void;
}) {
  const tasksOf = (s: Sprint) => (tab === "current" && isLive(s) ? data.tasks.filter((t) => t.sprint_id === s.id) : []);
  // Every selectable thing, in the order shown: the first one is selected until the user picks another.
  const entries: Sel[] = groups.flatMap((g) => [
    ...(g.pi ? [{ k: "pi", id: g.pi.id } as Sel] : []),
    ...g.sprints.flatMap((s) => [{ k: "sprint", id: s.id } as Sel, ...tasksOf(s).map((t) => ({ k: "task", id: t.id }) as Sel)]),
  ]);
  // Current PI opens on the first task (its detail is what you act on); the other tabs on their first row.
  const current = entries.find((e) => same(sel, e)) ?? (tab === "current" ? entries.find((e) => e.k === "task") : undefined) ?? entries[0] ?? null;
  const is = (e: Sel) => (same(current, e) ? "active" : "");
  const sprint = current?.k === "sprint" ? data.sprints.find((s) => s.id === current.id) : undefined;
  const pi = current?.k === "pi" ? data.pis.find((p) => p.id === current.id) : undefined;
  const active = data.pis.filter((p) => p.status === "active");

  return (
    <div className="tasks">
      <div className="tasks-list">
        {tab !== "releases" && (
          <div className="list-bar"><span className="spacer" />
            <button className="btn small" onClick={() => onNew("pi")}><Plus size={13} /> New PI</button>
            <button className="btn small primary" onClick={() => onNew("sprint")}><Plus size={13} /> New sprint</button></div>
        )}
        {groups.length === 0 && <div className="empty">{{
          coming: "No PI or sprint is planned. A PI groups sprints under one goal. A sprint takes the ready backlog items by priority up to the team's capacity.",
          current: "Nothing is being delivered. Start a sprint from Coming PI.",
          releases: "Nothing is released yet. A sprint is released after its tasks are merged.",
        }[tab]}</div>}
        {groups.map((g) => (
          <div key={g.pi?.id ?? "none"}>
            {g.pi ? (
              <div className={`task-row pi-row ${is({ k: "pi", id: g.pi.id })}`} onClick={() => setSel({ k: "pi", id: g.pi!.id })}>
                <div className="row" style={{ gap: 8 }}><b>PI: {g.pi.name}</b><span className={`badge ${g.pi.status === "active" ? "accent" : ""}`}>{g.pi.status}</span></div>
                <div className="hint ellipsis">{g.pi.goal || "No goal written"}</div>
              </div>
            ) : active.length > 0 && <div className="list-bar"><b>Without a PI</b></div>}
            {g.sprints.length === 0 && <div className="hint" style={{ padding: "8px 16px 8px 28px" }}>No sprint in this PI yet.</div>}
            {g.sprints.map((s) => {
              const tasks = tasksOf(s);
              const merged = data.tasks.filter((t) => t.sprint_id === s.id && t.status === "merged").length;
              const total = data.tasks.filter((t) => t.sprint_id === s.id).length;
              return (
                <div key={s.id}>
                  <div className={`task-row sprint-row ${is({ k: "sprint", id: s.id })}`} onClick={() => setSel({ k: "sprint", id: s.id })}>
                    <div className="row" style={{ gap: 8 }}>
                      <b>{sprintName(s)}</b>
                      <span className={`badge ${s.status === "active" ? "accent" : s.status === "released" ? "good" : s.status === "done" ? "wait" : ""}`}>{s.status === "done" ? "complete, not released" : s.status}</span>
                      {total > 0 && s.status !== "released" && <span className="badge">{merged}/{total} merged</span>}
                    </div>
                    <div className="hint ellipsis">{s.goal || "No goal written"}</div>
                  </div>
                  {tasks.map((t) => (
                    <div key={t.id} className={`task-row task-sub ${is({ k: "task", id: t.id })}`} onClick={() => setSel({ k: "task", id: t.id })}>
                      <div className="row" style={{ gap: 8 }}><StatusBadge status={t.status} /><span className="spacer" /><span className="hint">{money(t.cost_usd)}</span></div>
                      <b>{t.title}</b>
                      <div className="meta"><span>{t.worker ?? "no developer"}</span>{t.round > 0 && <span>round {t.round + 1}</span>}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {current?.k === "task" ? <TaskPane key={current.id} id={current.id} agents={agents} onAction={reload} />
        : sprint ? <SprintDetail key={sprint.id} s={sprint} data={data} reload={reload} onTask={(id) => setSel({ k: "task", id })} />
        : pi ? <PiDetail key={pi.id} pi={pi} sprints={data.sprints.filter((s) => s.pi_id === pi.id)} reload={reload} onNewSprint={() => onNew("sprint", pi.id)} />
        : <div className="empty">Select a PI or a sprint.</div>}
    </div>
  );
}

/** The full task view of Running tasks (merge, retry, review, activity) for a task of the selected sprint. */
function TaskPane({ id, agents, onAction }: { id: number; agents: Agent[]; onAction: () => void }) {
  const [task, setTask] = useState<Task | null>(null);
  const load = () => get<{ task: Task }>(`/api/tasks/${id}`).then((d) => setTask(d.task));
  useEffect(() => { load(); }, [id]);
  useLiveEvents((ev) => { if (ev.type === "task" && ev.task.id === id) setTask((t) => (t ? { ...t, ...ev.task } : t)); });
  if (!task) return <div className="empty">Loading…</div>;
  const name = (aid: number | null) => agents.find((a) => a.id === aid)?.name ?? "–";
  return <TaskDetail key={task.id} task={task} name={name} workers={agents.filter((a) => a.role === "worker" && a.enabled)} onAction={() => { load(); onAction(); }} />;
}

function PiDetail({ pi, sprints, reload, onNewSprint }: { pi: Pi; sprints: Sprint[]; reload: () => void; onNewSprint: () => void }) {
  const withNotes = sprints.filter((s) => s.release_notes).sort((a, b) => a.number - b.number);
  return (
    <div className="task-detail">
      <div>
        <div className="row"><span className={`badge ${pi.status === "active" ? "accent" : ""}`}>{pi.status}</span><span className="hint">program increment</span></div>
        <h2 style={{ margin: "6px 0 4px", fontSize: 18 }}>PI: {pi.name}</h2>
        <div className="msg-body">{pi.goal || <span className="hint">No goal written</span>}</div>
      </div>
      <div className="meta">
        <span>Sprints <b>{sprints.length}</b></span>
        <span>Released <b>{sprints.filter((s) => s.status === "released").length}</b></span>
      </div>
      <UsageLine u={pi.usage} label="All sprints of this PI" />
      <div className="row">
        {pi.status === "active" && <button className="btn" onClick={onNewSprint}><Plus size={14} /> New sprint in this PI</button>}
        <button className="btn" onClick={async () => { await put(`/api/pis/${pi.id}`, { status: pi.status === "active" ? "closed" : "active" }); reload(); }}>{pi.status === "active" ? "Close PI" : "Reopen PI"}</button>
      </div>
      {withNotes.length > 0 && (
        <details open>
          <summary><b>PI release notes</b></summary>
          <div className="msg-body">{withNotes.map((s) => <Markdown key={s.id}>{s.release_notes}</Markdown>)}</div>
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
    <div className="task-detail">
      <div>
        <div className="row">
          <span className={`badge ${s.status === "active" ? "accent" : s.status === "released" ? "good" : s.status === "done" ? "wait" : ""}`}>{s.status === "done" ? "complete, not released" : s.status}</span>
          {pi && <span className="hint">PI: {pi.name}</span>}
          {s.branch && <span className="hint mono">{s.branch}</span>}
        </div>
        <h2 style={{ margin: "6px 0 4px", fontSize: 18 }}>{sprintName(s)}</h2>
        <div className="msg-body">{s.goal || <span className="hint">No goal written</span>}</div>
      </div>
      <div className="meta">
        <span>Tasks <b>{tasks.length ? `${merged}/${tasks.length} merged` : "none yet"}</b></span>
        {s.capacity > 0 && <span>Capacity <b>{s.capacity} pts</b></span>}
        {s.released_at && <span>Released <b>{s.released_at.slice(0, 16).replace("T", " ")}</b></span>}
      </div>
      <UsageLine u={s.usage} />

      {s.status === "active" && (
        <div className="row action-bar">
          <button className="btn" disabled={busy} onClick={() => confirm("Close this sprint now? Unfinished items go back to the backlog.") && act(() => post(`/api/sprints/${s.id}/close`))}>Close sprint</button>
          <span className="hint">Approved tasks merge into <code>{s.branch}</code>; the base branch stays untouched until Release. Retry stopped tasks from their detail.</span>
        </div>
      )}
      {s.status === "done" && (
        <div className="row action-bar">
          <button className="btn primary" disabled={busy || s.busy} onClick={() => {
            const warn = s.security_verdict === "issues" ? "The security review found issues. " : !s.security_verdict ? "No security review was run. " : "";
            if (confirm(`${warn}Release sprint ${s.number}? \`${s.branch}\` is merged into the base branch and pushed (when the project has a remote).`)) act(() => post(`/api/sprints/${s.id}/release`));
          }}><Rocket size={14} /> Release to production</button>
          <button className="btn" disabled={busy || s.busy} onClick={() => act(() => post(`/api/sprints/${s.id}/security`))}><ShieldCheck size={14} /> {s.busy ? "Reviewing…" : s.security_verdict ? "Run security review again" : "Security review"}</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {s.status === "planning" && <PlanPanel s={s} data={data} reload={reload} />}

      {tasks.length > 0 && (
        <div>
          <b>Tasks</b>
          <div className="list" style={{ marginTop: 6 }}>
            {tasks.map((t) => (
              <div key={t.id} className="list-row clickable" onClick={() => onTask(t.id)}>
                <span style={{ flex: 1, minWidth: 0 }}><b>{t.title}</b><div className="hint ellipsis">{t.error || (t.worker ? `${t.worker}${t.round ? ` · round ${t.round + 1}` : ""}` : "no developer")}</div></span>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(s.status === "done" || s.status === "released") && (
        <>
          <div>
            <b>Release notes</b>
            <div className="card card-pad msg-body" style={{ marginTop: 6 }}>{s.release_notes ? <Markdown>{s.release_notes}</Markdown> : <span className="hint">Writing the release notes…</span>}</div>
          </div>
          <div>
            <b>Security review</b>{" "}
            {s.security_verdict ? <span className={`badge ${s.security_verdict === "pass" ? "good" : "bad"}`}>{s.security_verdict === "pass" ? "no blocking findings" : "issues found"}</span> : <span className="hint">(optional)</span>}
            {s.security_report && <div className="card card-pad msg-body" style={{ marginTop: 6 }}><Markdown>{s.security_report}</Markdown></div>}
          </div>
        </>
      )}
      {s.chat_id && <a className="hint" href={`#/chat/${s.chat_id}`}><MessageSquare size={12} /> Sprint chat</a>}
    </div>
  );
}

/** The Scrum master's proposal: ready items by priority up to capacity. Untick or tick to change it, then Start. */
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
    <div>
      <div className="row action-bar">
        <button className="btn primary" disabled={busy || blocked || pick.size === 0} onClick={start}><Play size={14} /> Start sprint</button>
        <button className="btn danger" onClick={async () => { if (confirm("Delete this planned sprint?")) { await del(`/api/sprints/${s.id}`); reload(); } }}>Delete sprint</button>
        {blocked && <span className="hint">Release the running sprint first.</span>}
      </div>
      {error && <div className="error">{error}</div>}
      <b>Plan the sprint</b>
      <div className="hint" style={{ margin: "4px 0 6px" }}>
        Scrum master's plan: ready items by priority, up to {p.capacity} points. <b style={{ color: used > p.capacity ? "var(--bad)" : undefined }}>{used} / {p.capacity}</b> chosen.
      </div>
      {p.items.length === 0 && <div className="card card-pad hint">No item is ready. Items become ready after the architect and a developer have refined them.</div>}
      {p.items.map((i) => (
        <label key={i.id} className="team-member clickable" style={{ opacity: i.too_big ? 0.5 : 1 }}>
          <input type="checkbox" checked={pick.has(i.id)} disabled={i.too_big}
            onChange={() => setPick((x) => { const n = new Set(x); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })} />
          <span className="ellipsis" style={{ flex: 1 }}>{i.title}</span>
          <span className="badge">{i.points ?? "?"} pts</span>{i.too_big && <span className="badge bad">too big</span>}
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
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!name.trim()}>Create</button></>}>
      <Field label="Name"><NoFillInput value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "pi" ? "e.g. PI 1: reporting" : "e.g. Sprint 1"} /></Field>
      <Field label="Goal"><textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should be true when it ends?" /></Field>
      {kind === "sprint" && (
        <Field label="PI (optional)" hint="A PI groups sprints; their release notes and token use add up.">
          <select value={pi} onChange={(e) => setPi(e.target.value ? Number(e.target.value) : "")}>
            <option value="">No PI</option>
            {pis.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}
