import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { get, useLiveEvents, type Run } from "../api.ts";
import { money } from "./ui.tsx";

export type Entry = {
  t: number; kind: "instructions" | "prompt" | "thinking" | "model" | "tool" | "note" | "error";
  text?: string; tool?: string; input?: unknown; output?: string; isError?: boolean; ms?: number;
  tokens?: { in: number; out: number; cacheRead?: number };
};

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const FINISH = new Set(["finish", "submit_plan", "submit_review", "submit_notes"]);
const RUN_LABEL: Record<string, string> = {
  build: "Build", review: "Review", checks: "Checks", plan: "Plan", notes: "Notes",
  backlog: "Product manager", refine: "Refinement", security: "Security review",
};

/** One line for a tool call: "Read index.html", "$ npm test", "Edit css/site.css". */
function describe(e: Entry): string {
  const i = (e.input ?? {}) as Record<string, any>;
  const file = String(i.path ?? i.file_path ?? "").split(/[\\/]/).slice(-3).join("/");
  switch (e.tool) {
    case "read_file": case "Read": return `Read ${file}`;
    case "write_file": case "Write": return `Write ${file}`;
    case "edit_file": case "Edit": case "MultiEdit": return `Edit ${file}`;
    case "list_files": case "LS": return `List ${file || "."}${i.glob ? ` ${i.glob}` : ""}`;
    case "Glob": return `Find ${i.pattern ?? ""}`;
    case "search": case "Grep": return `Search "${i.pattern ?? ""}"`;
    case "run_command": case "Bash": return `$ ${i.command ?? ""}`;
    case "command": return `$ ${typeof e.input === "string" ? e.input : ""}`;
    default: return FINISH.has(e.tool ?? "") ? "Finished" : e.tool ?? "tool";
  }
}

type Group = { kind: "tools"; items: Entry[] } | { kind: "one"; e: Entry };

/** Consecutive tool calls fold into one "Ran N tools" group; the CLI's separate results join their call. */
function group(entries: Entry[]): Group[] {
  const out: Group[] = [];
  for (const e of entries) {
    if (e.kind === "tool") {
      const last = out[out.length - 1];
      if (e.tool === "result" && last?.kind === "tools") {
        const call = [...last.items].reverse().find((x) => x.output === undefined);
        if (call) { call.output = e.output; call.isError = e.isError; continue; }
      }
      if (last?.kind === "tools") last.items.push({ ...e }); else out.push({ kind: "tools", items: [{ ...e }] });
    } else out.push({ kind: "one", e });
  }
  return out;
}

export function Steps({ entries, showThinking }: { entries: Entry[]; showThinking: boolean }) {
  const groups = useMemo(() => group(entries.filter((e) => showThinking || e.kind !== "thinking")), [entries, showThinking]);
  return (
    <div className="steps-list">
      {groups.map((g, i) => g.kind === "tools"
        ? <ToolGroup key={i} items={g.items} />
        : <OneStep key={i} e={g.e} />)}
    </div>
  );
}

function OneStep({ e }: { e: Entry }) {
  if (e.kind === "instructions" || e.kind === "prompt") {
    return (
      <details className="step-fold">
        <summary>{e.kind === "instructions" ? "Instructions" : "Task sent to the agent"} <span className="hint">{(e.text ?? "").length.toLocaleString()} characters</span></summary>
        <pre>{e.text}</pre>
      </details>
    );
  }
  if (e.kind === "thinking") return <details className="step-fold"><summary>Thinking <span className="hint">{secs(e.t)}</span></summary><pre>{e.text}</pre></details>;
  if (e.kind === "note") return <div className="step-note">↺ {e.text}</div>;
  if (e.kind === "error") return <div className="step-error">✗ {e.text}</div>;
  // model turn
  return (
    <div className="step-model">
      {e.text ? <div className="msg-body"><Markdown>{e.text}</Markdown></div> : null}
      <div className="hint step-meta">{e.ms !== undefined && `turn took ${secs(e.ms)}`}{e.tokens && ` · ${e.tokens.in.toLocaleString()} in${e.tokens.cacheRead ? ` (${e.tokens.cacheRead.toLocaleString()} cached)` : ""} · ${e.tokens.out.toLocaleString()} out`}</div>
    </div>
  );
}

function ToolGroup({ items }: { items: Entry[] }) {
  const failed = items.some((x) => x.isError);
  const [open, setOpen] = useState(false);
  const commands = items.every((x) => ["run_command", "Bash", "command"].includes(x.tool ?? ""));
  const shown = items.filter((x) => !FINISH.has(x.tool ?? ""));
  if (!shown.length) return null;
  return (
    <div className={`tool-group ${failed ? "failed" : ""}`}>
      <button type="button" className="tool-group-head" onClick={() => setOpen(!open)}>
        Ran {shown.length} {commands ? "command" : "tool"}{shown.length === 1 ? "" : "s"}
        {!open && <span className="hint ellipsis"> · {shown.slice(0, 3).map(describe).join(" · ")}{shown.length > 3 ? " …" : ""}</span>}
        {failed && <span className="badge bad">error</span>}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && shown.map((x, i) => <ToolCall key={i} e={x} />)}
    </div>
  );
}

function ToolCall({ e }: { e: Entry }) {
  const [open, setOpen] = useState(!!e.isError);
  const input = typeof e.input === "string" ? e.input : JSON.stringify(e.input, null, 2);
  return (
    <div className={`tool-call ${e.isError ? "failed" : ""}`}>
      <button type="button" className="tool-call-head" onClick={() => setOpen(!open)}>
        <span className="mono ellipsis">{describe(e)}</span>
        {e.ms !== undefined && <span className="hint">{secs(e.ms)}</span>}
        {e.output === undefined ? <Loader2 size={12} className="spin" /> : null}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="tool-call-body">
          <div className="hint">Request</div><pre>{input}</pre>
          {e.output !== undefined && <><div className="hint">Response</div><pre>{e.output}</pre></>}
        </div>
      )}
    </div>
  );
}

/** Every agent call of a task, newest open: model answers in the open, tool calls folded, live while it runs. */
export function TaskActivity({ taskId, runs, agentName, onNewRun }: {
  taskId: number; runs: Run[]; agentName: (id: number | null) => string; onNewRun: () => void;
}) {
  const [live, setLive] = useState<Record<number, Entry[]>>({});
  const [loaded, setLoaded] = useState<Record<number, Entry[]>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [showThinking, setShowThinking] = useState(false);
  const known = useRef(new Set<number>());
  known.current = new Set(runs.map((r) => r.id));

  useLiveEvents((ev) => {
    if (ev.type !== "step" || ev.taskId !== taskId) return;
    if (!known.current.has(ev.runId)) onNewRun();
    setLive((m) => ({ ...m, [ev.runId]: [...(m[ev.runId] ?? []), ev.entry as Entry] }));
  });

  const newest = runs.at(-1)?.id;
  const isOpen = (id: number) => open[id] ?? id === newest;
  useEffect(() => {
    for (const r of runs) {
      if (!isOpen(r.id) || loaded[r.id]) continue;
      get<{ transcript: Entry[] }>(`/api/runs/${r.id}`).then((d) => {
        if (r.status === "running") {
          // Steps so far from the server, then whatever arrived live after the last of them.
          setLive((m) => {
            const last = d.transcript.at(-1)?.t ?? -1;
            return { ...m, [r.id]: [...d.transcript, ...(m[r.id] ?? []).filter((e) => e.t > last)] };
          });
        } else setLoaded((m) => ({ ...m, [r.id]: d.transcript }));
      });
    }
  }, [runs.map((r) => `${r.id}:${r.status}`).join(","), JSON.stringify(open)]);

  const [openRound, setOpenRound] = useState<Record<number, boolean>>({});
  const rounds = [...new Set(runs.map((r) => r.round))].sort((a, b) => b - a);
  if (!runs.length) return <div className="hint">Nothing yet. Steps appear here as soon as an agent starts.</div>;
  return (
    <div className="activity">
      <label className="row hint" style={{ gap: 6 }}><input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} /> Show the model's thinking (when it shares it)</label>
      {rounds.map((round) => {
        const list = runs.filter((r) => r.round === round).reverse();
        const roundIsOpen = openRound[round] ?? round === rounds[0];
        const builds = list.filter((r) => r.kind === "build").length;
        const review = list.find((r) => r.kind === "review" && r.status !== "running");
        const running = list.some((r) => r.status === "running");
        return (
          <div key={round} className={`round-group ${roundIsOpen ? "open" : ""}`}>
            <button type="button" className="round-head" onClick={() => setOpenRound((m) => ({ ...m, [round]: !roundIsOpen }))}>
              {roundIsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <b>Round {round + 1}</b>
              <span className="hint">
                {builds ? `${builds} build${builds === 1 ? "" : "s"}` : ""}
                {list.some((r) => r.kind === "checks") ? " · checks" : ""}
                {review ? ` · review` : ""}
              </span>
              <span className="spacer" />
              {running ? <span className="status s-building">running</span>
                : review ? <span className={`badge ${{ approve: "good", changes: "bad", unknown: "" }[reviewVerdict(review)]}`}>{{ approve: "approved", changes: "changes asked", unknown: "reviewed" }[reviewVerdict(review)]}</span>
                : list[0] && list[0].status !== "done" ? <span className="badge bad">{list[0].status}</span> : null}
              {roundCost(list) ? <span className="hint">{money(roundCost(list))}</span> : null}
            </button>
            {roundIsOpen && <div className="round-body">{list.map((r) => {
        const entries = r.status === "running" ? (live[r.id] ?? []) : (loaded[r.id] ?? live[r.id] ?? []);
        return (
          <div key={r.id} className={`run-section ${r.status}`}>
            <button type="button" className="run-head" onClick={() => setOpen((m) => ({ ...m, [r.id]: !isOpen(r.id) }))}>
              {isOpen(r.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <b>{RUN_LABEL[r.kind] ?? r.kind}</b>
              <span>{agentName(r.agent_id)}</span>
              {r.model && <span className="hint mono">{r.model}</span>}
              <span className="spacer" />
              {r.status === "running"
                ? <span className="status s-building">running</span>
                : <span className={`badge ${r.status === "done" ? "good" : "bad"}`}>{r.status}</span>}
              <span className="hint">{r.turns ?? "–"} {r.kind === "checks" ? "commands" : "turns"} · {r.seconds ?? "–"} s{r.cost_usd ? ` · ${money(r.cost_usd)}` : ""}</span>
            </button>
            {isOpen(r.id) && (
              entries.length ? <Steps entries={entries} showThinking={showThinking} />
                : r.status === "running" ? <div className="hint" style={{ padding: "6px 10px" }}>Waiting for the first answer…</div>
                : <pre className="logbox">{r.log || "No step log for this run (it ran before step logging was added)."}</pre>
            )}
            {isOpen(r.id) && r.status !== "running" && runError(r) && !entries.some((e) => e.kind === "error") && (
              <div className="run-error">✗ {runError(r)}</div>
            )}
          </div>
        );
      })}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** The error a finished run stopped with (stored at the start of its summary). */
function runError(r: Run) {
  const m = /^ERROR: ([^\n]*)/.exec(r.summary ?? "");
  return r.status === "done" ? "" : m?.[1] ?? "";
}

/** The reviewer's verdict, read from the start of its stored answer. */
function reviewVerdict(r: Run) {
  const m = /^Verdict: (\w+)/m.exec(r.summary ?? "");
  return m ? (m[1] === "approve" ? "approve" : "changes") : "unknown"; // runs from before the verdict was stored
}

function roundCost(list: Run[]) {
  return list.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
}
