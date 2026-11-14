import { useState } from "react";
import Markdown from "react-markdown";
import { ArrowDown, ArrowUp, Plus, RotateCcw } from "lucide-react";
import { post, put, parseJson } from "../../api.ts";
import { Field, ToneBadge, money } from "../../components/ui.tsx";
import { Choice, NoFillInput } from "../../components/inputs.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type Item, type Overview, type Sel, STEP, same, SIZES } from "./model.ts";
import { UsageLine } from "./UsageLine.tsx";

export function BacklogView({ data, sel, setSel, reload }: { data: Overview; sel: Sel | null; setSel: (s: Sel | null) => void; reload: () => void }) {
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
    <div key={i.id} role="presentation" className={cn("grid cursor-pointer grid-cols-[auto_1fr] items-start gap-2 border-b px-4 py-3", same(current, { k: "item", id: i.id }) && "bg-accent")} onClick={() => setSel({ k: "item", id: i.id })}>
      {movable.includes(i) ? (
        <span className="flex flex-col">
          <Button variant="ghost" size="icon-xs" title="Higher priority" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><ArrowUp /></Button>
          <Button variant="ghost" size="icon-xs" title="Lower priority" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><ArrowDown /></Button>
        </span>
      ) : <span className="w-5" />}
      <div className="flex min-w-0 flex-col gap-1">
        <button type="button" className="text-left font-bold" aria-current={same(current, { k: "item", id: i.id }) ? "true" : undefined} onClick={() => setSel({ k: "item", id: i.id })}>{i.title}</button>
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
