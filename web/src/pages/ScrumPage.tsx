import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { ArrowDown, ArrowUp, Plus, Rocket, ShieldCheck, ChevronDown, ChevronRight, Pencil, RotateCcw, Play, MessageSquare, Flag } from "lucide-react";
import { get, post, put, del, useLoad, useLiveEvents, parseJson } from "../api.ts";
import { Field, Modal, StatusBadge, money } from "../components/ui.tsx";
import { NoFillInput } from "../components/inputs.tsx";

type Usage = {
  cost: number; tokens: number; runs: number;
  by_kind: Record<string, { cost: number; tokens: number; runs: number }>; by_model: Record<string, { cost: number; tokens: number; runs: number }>;
};
type Item = {
  id: number; sprint_id: number | null; title: string; request: string; story: string; acceptance: string; tech_notes: string; paths: string;
  worker: string; points: number | null; priority: number; status: "refining" | "ready" | "in_sprint" | "done" | "dropped" | "error";
  step: string; error: string; refining: boolean;
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

const SIZES = [1, 2, 3, 5, 8, 13];
const KIND: Record<string, string> = { backlog: "product manager", refine: "refinement", build: "development", review: "QA", security: "security review", notes: "release notes", plan: "planning", checks: "checks" };
const STEP: Record<string, string> = { product: "product manager drafting", architect: "architect adding technical notes", estimate: "developer estimating" };
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

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

/** Backlog and sprints of a Scrum project. */
export function ScrumPage({ projectId }: { projectId: number }) {
  const { data, reload } = useLoad<Overview>(`/api/projects/${projectId}/scrum`);
  const [tab, setTab] = useState<"backlog" | "sprints">("backlog");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [modal, setModal] = useState<"pi" | "sprint" | null>(null);
  useLiveEvents((ev) => { if ((ev.type === "scrum" && ev.projectId === projectId) || ev.type === "task") reload(); });
  if (!data) return <div className="page"><div className="narrow hint">Loading…</div></div>;
  if (data.project.process !== "scrum") {
    return <><div className="page-head"><h1>Backlog & sprints</h1></div><div className="page"><div className="narrow card card-pad">
      {data.project.name} runs as free chat. Change <b>How work is run</b> to Scrum under <a href="#/projects">Projects</a>.
    </div></div></>;
  }
  const savePoints = async (n: number) => { await put(`/api/projects/${projectId}/scrum/settings`, { points_per_dev: n }); reload(); };

  return (
    <>
      <div className="page-head">
        <span className="crumb">{data.project.name}</span><span className="crumb">/</span><h1>Backlog & sprints</h1>
        <div className="tabs">
          <button className={`tab ${tab === "backlog" ? "active" : ""}`} onClick={() => setTab("backlog")}>Backlog · {data.items.filter((i) => !["done", "dropped"].includes(i.status)).length}</button>
          <button className={`tab ${tab === "sprints" ? "active" : ""}`} onClick={() => setTab("sprints")}>Sprints · {data.sprints.length}</button>
        </div>
      </div>
      <div className="page"><div className="narrow" style={{ maxWidth: 1000 }}>
        <div className="card card-pad scrum-step">
          <Flag size={15} /> <div style={{ flex: 1 }}><b>{data.cycle.text}</b>
            <div className="hint">Add items any time in the project's chat ("we need …", "review the backlog") or here.</div></div>
          <label className="hint row" style={{ gap: 6 }} title="Sprint capacity = developers in the team × points per developer">
            Capacity {data.capacity.capacity} pts = {data.capacity.developers} dev × <NoFillInput type="number" min={1} max={60} defaultValue={data.capacity.points_per_dev} style={{ width: 56 }}
              onBlur={(e) => { const n = Number(e.target.value); if (n && n !== data.capacity.points_per_dev) savePoints(n); }} />
          </label>
        </div>

        {tab === "backlog" ? <Backlog data={data} reload={reload} onEdit={setEditing} onAdd={() => setEditing("new")} />
          : <Sprints data={data} reload={reload} onNew={setModal} />}

        {data.unplanned.runs > 0 && <div style={{ marginTop: 18 }}><UsageLine u={data.unplanned} label="Not in any sprint yet (refining items, product manager chat)" /></div>}
      </div></div>
      {editing && <ItemModal item={editing === "new" ? null : editing} projectId={projectId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {modal && <NameModal kind={modal} projectId={projectId} pis={data.pis.filter((p) => p.status === "active")} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); setTab("sprints"); }} />}
    </>
  );
}

// ---------- backlog ----------

function Backlog({ data, reload, onEdit, onAdd }: { data: Overview; reload: () => void; onEdit: (i: Item) => void; onAdd: () => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const open = data.items.filter((i) => !["done", "dropped"].includes(i.status));
  const closed = data.items.filter((i) => ["done", "dropped"].includes(i.status));
  const movable = open.filter((i) => i.status === "ready" || i.status === "refining" || i.status === "error");
  const move = async (i: Item, dir: -1 | 1) => {
    const ids = movable.map((x) => x.id);
    const at = ids.indexOf(i.id), to = at + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    await put(`/api/projects/${data.project.id}/backlog/order`, { ids });
    reload();
  };
  const sprintOf = (i: Item) => data.sprints.find((s) => s.id === i.sprint_id);
  const row = (i: Item) => (
    <div key={i.id} className="list-row backlog-row">
      {movable.includes(i) ? (
        <span className="col" style={{ display: "flex", flexDirection: "column" }}>
          <button className="icon-btn" title="Higher priority" onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
          <button className="icon-btn" title="Lower priority" onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
        </span>
      ) : <span style={{ width: 26 }} />}
      <div style={{ minWidth: 0, flex: 1, cursor: "pointer" }} onClick={() => onEdit(i)}>
        <b>{i.title}</b>{" "}
        {i.status === "refining" && <span className="badge wait">{STEP[i.step] ?? "refining"}…</span>}
        {i.status === "ready" && <span className="badge good">ready</span>}
        {i.status === "in_sprint" && <span className="badge accent">sprint {sprintOf(i)?.number}</span>}
        {i.status === "done" && <span className="badge good">done</span>}
        {i.status === "dropped" && <span className="badge">dropped</span>}
        {i.status === "error" && <span className="badge bad">stopped</span>}
        {i.points != null && <span className="badge" title="Story points">{i.points} pts</span>}
        {i.worker && <span className="badge" title="Developer the architect suggested">{i.worker}</span>}
        <div className="hint ellipsis">{i.error || i.story.replace(/\s+/g, " ") || i.request}</div>
      </div>
      {i.status === "error" && <button className="btn small" onClick={async () => { await post(`/api/backlog/${i.id}/retry`); reload(); }}><RotateCcw size={13} /> Retry</button>}
      <button className="icon-btn" title="Open" onClick={() => onEdit(i)}><Pencil size={14} /></button>
    </div>
  );
  return (
    <>
      <div className="section-title"><h2>Backlog, by priority</h2><span className="spacer" />
        <button className="btn primary" onClick={onAdd}><Plus size={14} /> Add item</button></div>
      <div className="list">
        {open.length === 0 && <div className="list-row hint">The backlog is empty. Describe what the business owners need in the project's chat, or add an item here: the product manager writes the story, the architect the technical notes, a developer sizes it.</div>}
        {open.map(row)}
      </div>
      {closed.length > 0 && (
        <>
          <button className="btn small" style={{ marginTop: 14 }} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Done and dropped · {closed.length}
          </button>
          {showClosed && <div className="list" style={{ marginTop: 8 }}>{closed.map(row)}</div>}
        </>
      )}
    </>
  );
}

function ItemModal({ item, projectId, onClose, onSaved }: { item: Item | null; projectId: number; onClose: () => void; onSaved: () => void }) {
  const locked = item ? ["in_sprint", "done"].includes(item.status) : false;
  const [f, setF] = useState({
    title: item?.title ?? "", request: item?.request ?? "", story: item?.story ?? "", acceptance: item?.acceptance ?? "", tech_notes: item?.tech_notes ?? "",
    paths: parseJson<string[]>(item?.paths, []).join("\n"), points: item?.points ?? null as number | null,
  });
  const [error, setError] = useState("");
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setError("");
    try {
      if (!item) await post(`/api/projects/${projectId}/backlog`, { title: f.title, description: f.request });
      else await put(`/api/backlog/${item.id}`, { title: f.title, story: f.story, acceptance: f.acceptance, tech_notes: f.tech_notes, paths: f.paths, points: f.points });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const drop = async () => { await put(`/api/backlog/${item!.id}`, { status: "dropped" }); onSaved(); };
  return (
    <Modal title={item ? item.title : "Add a backlog item"} onClose={onClose} wide
      footer={<>
        {item && !locked && <button className="btn danger" onClick={drop}>Drop item</button>}
        <span className="spacer" /><button className="btn" onClick={onClose}>{locked ? "Close" : "Cancel"}</button>
        {!locked && <button className="btn primary" onClick={save}>{item ? "Save" : "Add to backlog"}</button>}
      </>}>
      {!item ? (
        <>
          <Field label="What is needed"><NoFillInput value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Export the report as PDF" /></Field>
          <Field label="In the business owner's words" hint="The product manager turns this into a user story with acceptance criteria; then the architect and a developer refine it.">
            <textarea rows={5} value={f.request} onChange={(e) => set("request", e.target.value)} />
          </Field>
        </>
      ) : (
        <>
          {locked && <div className="hint" style={{ marginBottom: 8 }}>This item is in a sprint: its text is fixed.</div>}
          {item.error && <div className="error" style={{ marginBottom: 8 }}>{item.error}</div>}
          <Field label="Title"><NoFillInput value={f.title} disabled={locked} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="User story (product manager)"><textarea rows={3} disabled={locked} value={f.story} onChange={(e) => set("story", e.target.value)} /></Field>
          <Field label="Acceptance criteria"><textarea rows={4} disabled={locked} value={f.acceptance} onChange={(e) => set("acceptance", e.target.value)} /></Field>
          <Field label="Technical notes (architect)"><textarea className="mono" rows={7} disabled={locked} value={f.tech_notes} onChange={(e) => set("tech_notes", e.target.value)} /></Field>
          <div className="grid2">
            <Field label="Files it may change (one per line)"><textarea className="mono" rows={3} disabled={locked} value={f.paths} onChange={(e) => set("paths", e.target.value)} /></Field>
            <Field label="Size (story points)" hint="Set by a developer; change it if you know better. 13 means too big: split it.">
              <select disabled={locked} value={f.points ?? ""} onChange={(e) => set("points", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Not estimated</option>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

// ---------- sprints and PIs ----------

function Sprints({ data, reload, onNew }: { data: Overview; reload: () => void; onNew: (k: "pi" | "sprint") => void }) {
  const loose = data.sprints.filter((s) => !s.pi_id || !data.pis.some((p) => p.id === s.pi_id));
  return (
    <>
      <div className="section-title"><h2>Sprints</h2><span className="spacer" />
        <button className="btn" onClick={() => onNew("pi")}><Plus size={14} /> New PI</button>{" "}
        <button className="btn primary" style={{ marginLeft: 8 }} onClick={() => onNew("sprint")}><Plus size={14} /> New sprint</button></div>
      {data.sprints.length === 0 && data.pis.length === 0 && (
        <div className="card card-pad">No sprint yet. A sprint takes the ready backlog items by priority up to the team's capacity. A PI is optional: it groups sprints under one goal and adds up their notes and token use.</div>
      )}
      {data.pis.map((pi) => <PiBlock key={pi.id} pi={pi} sprints={data.sprints.filter((s) => s.pi_id === pi.id)} data={data} reload={reload} />)}
      {loose.length > 0 && data.pis.length > 0 && <div className="section-title"><h2>Without a PI</h2></div>}
      {loose.map((s) => <SprintCard key={s.id} s={s} data={data} reload={reload} />)}
    </>
  );
}

function PiBlock({ pi, sprints, data, reload }: { pi: Pi; sprints: Sprint[]; data: Overview; reload: () => void }) {
  const [notes, setNotes] = useState(false);
  const withNotes = sprints.filter((s) => s.release_notes).sort((a, b) => a.number - b.number);
  return (
    <div className="pi-block">
      <div className="pi-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>PI: {pi.name}</b> <span className={`badge ${pi.status === "active" ? "accent" : ""}`}>{pi.status}</span>
          <div className="hint">{pi.goal || "No goal written"}</div>
          <UsageLine u={pi.usage} label="All sprints of this PI" />
        </div>
        {withNotes.length > 0 && <button className="btn small" onClick={() => setNotes(!notes)}>{notes ? "Hide" : "Show"} PI release notes</button>}
        <button className="btn small" onClick={async () => { await put(`/api/pis/${pi.id}`, { status: pi.status === "active" ? "closed" : "active" }); reload(); }}>{pi.status === "active" ? "Close PI" : "Reopen"}</button>
      </div>
      {notes && <div className="card card-pad msg-body" style={{ margin: "8px 0" }}>{withNotes.map((s) => <Markdown key={s.id}>{s.release_notes}</Markdown>)}</div>}
      {sprints.length === 0 && <div className="hint" style={{ padding: "6px 2px" }}>No sprint in this PI yet.</div>}
      {sprints.map((s) => <SprintCard key={s.id} s={s} data={data} reload={reload} />)}
    </div>
  );
}

function SprintCard({ s, data, reload }: { s: Sprint; data: Overview; reload: () => void }) {
  const [open, setOpen] = useState(s.status !== "released");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tasks = data.tasks.filter((t) => t.sprint_id === s.id);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const merged = tasks.filter((t) => t.status === "merged").length;
  return (
    <div className="card sprint-card">
      <div className="sprint-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{/^sprint\b/i.test(s.name) ? s.name : `Sprint ${s.number}: ${s.name}`}</b>{" "}
          <span className={`badge ${s.status === "active" ? "accent" : s.status === "released" ? "good" : s.status === "done" ? "wait" : ""}`}>{s.status === "done" ? "complete, not released" : s.status}</span>
          {s.status === "active" && <span className="badge">{merged}/{tasks.length} merged</span>}
          <div className="hint">{s.goal || "No goal written"}</div>
        </div>
        <UsageLine u={s.usage} />
      </div>
      {open && (
        <div className="sprint-body">
          {s.status === "planning" && <PlanPanel s={s} data={data} reload={reload} />}
          {tasks.length > 0 && (
            <div className="list" style={{ marginBottom: 10 }}>
              {tasks.map((t) => (
                <a key={t.id} className="list-row" href={`#/chat/${t.chat_id}?tab=tasks`} style={{ color: "inherit", textDecoration: "none" }}>
                  <span style={{ flex: 1, minWidth: 0 }}><b>{t.title}</b><div className="hint ellipsis">{t.error || (t.worker ? `${t.worker}${t.round ? ` · round ${t.round + 1}` : ""}` : "no developer")}</div></span>
                  <StatusBadge status={t.status} />
                </a>
              ))}
            </div>
          )}
          {s.status === "active" && (
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="hint">Approved tasks merge into <code>{s.branch}</code>; the base branch stays untouched until Release. Retry stopped tasks from Running tasks.</span>
              <span className="spacer" />
              <button className="btn small" disabled={busy} onClick={() => confirm("Close this sprint now? Unfinished items go back to the backlog.") && act(() => post(`/api/sprints/${s.id}/close`))}>Close sprint</button>
            </div>
          )}
          {(s.status === "done" || s.status === "released") && (
            <>
              <div className="hint" style={{ marginBottom: 4 }}>Release notes</div>
              <div className="card card-pad msg-body" style={{ marginBottom: 10 }}>{s.release_notes ? <Markdown>{s.release_notes}</Markdown> : <span className="hint">Writing the release notes…</span>}</div>
              <div className="hint" style={{ marginBottom: 4 }}>Security review {s.security_verdict ? <span className={`badge ${s.security_verdict === "pass" ? "good" : "bad"}`}>{s.security_verdict === "pass" ? "no blocking findings" : "issues found"}</span> : <span>(optional)</span>}</div>
              {s.security_report && <div className="card card-pad msg-body" style={{ marginBottom: 10 }}><Markdown>{s.security_report}</Markdown></div>}
            </>
          )}
          {s.status === "done" && (
            <div className="row">
              <button className="btn" disabled={busy || s.busy} onClick={() => act(() => post(`/api/sprints/${s.id}/security`))}><ShieldCheck size={14} /> {s.busy ? "Reviewing…" : s.security_verdict ? "Run security review again" : "Security review"}</button>
              <span className="spacer" />
              <button className="btn primary" disabled={busy || s.busy} onClick={() => {
                const warn = s.security_verdict === "issues" ? "The security review found issues. " : !s.security_verdict ? "No security review was run. " : "";
                if (confirm(`${warn}Release sprint ${s.number}? \`${s.branch}\` is merged into the base branch and pushed (when the project has a remote).`)) act(() => post(`/api/sprints/${s.id}/release`));
              }}><Rocket size={14} /> Release to production</button>
            </div>
          )}
          {s.status === "released" && s.released_at && <div className="hint">Released {s.released_at.slice(0, 16).replace("T", " ")}.</div>}
          {s.chat_id && <a className="hint" href={`#/chat/${s.chat_id}`}><MessageSquare size={12} /> Sprint chat</a>}
          {error && <div className="error">{error}</div>}
        </div>
      )}
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
    <div style={{ marginBottom: 10 }}>
      <div className="hint" style={{ marginBottom: 6 }}>
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
      <div className="row" style={{ marginTop: 8 }}>
        {blocked && <span className="hint">Release the running sprint first.</span>}
        <span className="spacer" />
        <button className="btn small danger" onClick={async () => { if (confirm("Delete this planned sprint?")) { await del(`/api/sprints/${s.id}`); reload(); } }}>Delete</button>
        <button className="btn primary" disabled={busy || blocked || pick.size === 0} onClick={start}><Play size={14} /> Start sprint</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function NameModal({ kind, projectId, pis, onClose, onSaved }: { kind: "pi" | "sprint"; projectId: number; pis: Pi[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [pi, setPi] = useState<number | "">(pis[0]?.id ?? "");
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
