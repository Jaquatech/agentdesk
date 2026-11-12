import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { ChevronDown, ChevronRight } from "lucide-react";
import { get, useLiveEvents, type Run } from "../api.ts";
import { StatusBadge, ToneBadge, money } from "./ui.tsx";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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

const pre = "my-1 max-h-80 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap";

export function Steps({ entries, showThinking }: { entries: Entry[]; showThinking: boolean }) {
  const groups = useMemo(() => group(entries.filter((e) => showThinking || e.kind !== "thinking")), [entries, showThinking]);
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3">
      {groups.map((g, i) => g.kind === "tools"
        ? <ToolGroup key={i} items={g.items} />
        : <OneStep key={i} e={g.e} />)}
    </div>
  );
}

function OneStep({ e }: { e: Entry }) {
  if (e.kind === "instructions" || e.kind === "prompt") {
    return (
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">{e.kind === "instructions" ? "Instructions" : "Task sent to the agent"} <span>{(e.text ?? "").length.toLocaleString()} characters</span></summary>
        <pre className={pre}>{e.text}</pre>
      </details>
    );
  }
  if (e.kind === "thinking") return <details><summary className="cursor-pointer text-xs text-muted-foreground">Thinking <span>{secs(e.t)}</span></summary><pre className={pre}>{e.text}</pre></details>;
  if (e.kind === "note") return <div className="text-xs text-warning">↺ {e.text}</div>;
  if (e.kind === "error") return <div className="text-sm text-destructive">✗ {e.text}</div>;
  return (
    <div className="text-sm">
      {e.text ? <div className="markdown"><Markdown>{e.text}</Markdown></div> : null}
      <div className="text-[11px] text-muted-foreground">{e.ms !== undefined && `turn took ${secs(e.ms)}`}{e.tokens && ` · ${e.tokens.in.toLocaleString()} in${e.tokens.cacheRead ? ` (${e.tokens.cacheRead.toLocaleString()} cached)` : ""} · ${e.tokens.out.toLocaleString()} out`}</div>
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
    <div className={cn("overflow-hidden rounded-lg border", failed && "border-destructive")}>
      <button type="button" className="flex w-full min-w-0 items-center gap-1.5 bg-muted px-2.5 py-1.5 text-left text-xs" onClick={() => setOpen(!open)}>
        Ran {shown.length} {commands ? "command" : "tool"}{shown.length === 1 ? "" : "s"}
        {!open && <span className="truncate text-muted-foreground"> · {shown.slice(0, 3).map(describe).join(" · ")}{shown.length > 3 ? " …" : ""}</span>}
        {failed && <ToneBadge tone="bad">error</ToneBadge>}
        {open ? <ChevronDown className="ml-auto" /> : <ChevronRight className="ml-auto" />}
      </button>
      {open && shown.map((x, i) => <ToolCall key={i} e={x} />)}
    </div>
  );
}

function ToolCall({ e }: { e: Entry }) {
  const [open, setOpen] = useState(!!e.isError);
  const input = typeof e.input === "string" ? e.input : JSON.stringify(e.input, null, 2);
  return (
    <div className="border-t">
      <button type="button" className={cn("flex w-full min-w-0 items-center gap-2 py-1 pr-2.5 pl-4 text-left text-xs", e.isError && "text-destructive")} onClick={() => setOpen(!open)}>
        <span className="truncate font-mono">{describe(e)}</span>
        {e.ms !== undefined && <span className="text-muted-foreground">{secs(e.ms)}</span>}
        {e.output === undefined ? <Spinner className="size-3" /> : null}
        {open ? <ChevronDown className="ml-auto" /> : <ChevronRight className="ml-auto" />}
      </button>
      {open && (
        <div className="px-2.5 pb-1.5 pl-4 text-xs">
          <div className="text-muted-foreground">Request</div><pre className={pre}>{input}</pre>
          {e.output !== undefined && <><div className="text-muted-foreground">Response</div><pre className={pre}>{e.output}</pre></>}
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
  if (!runs.length) return <p className="text-sm text-muted-foreground">Nothing yet. Steps appear here as soon as an agent starts.</p>;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={showThinking} onCheckedChange={(v) => setShowThinking(v === true)} /> Show the model's thinking (when it shares it)</label>
      {rounds.map((round) => {
        const list = runs.filter((r) => r.round === round).reverse();
        const roundIsOpen = openRound[round] ?? round === rounds[0];
        const builds = list.filter((r) => r.kind === "build").length;
        const review = list.find((r) => r.kind === "review" && r.status !== "running");
        const running = list.some((r) => r.status === "running");
        const verdict = review ? reviewVerdict(review) : "unknown";
        return (
          <div key={round} className="overflow-hidden rounded-xl border">
            <button type="button" className="flex w-full items-center gap-2 bg-muted px-2.5 py-2 text-left text-sm" onClick={() => setOpenRound((m) => ({ ...m, [round]: !roundIsOpen }))}>
              {roundIsOpen ? <ChevronDown /> : <ChevronRight />}
              <b>Round {round + 1}</b>
              <span className="text-xs text-muted-foreground">
                {builds ? `${builds} build${builds === 1 ? "" : "s"}` : ""}
                {list.some((r) => r.kind === "checks") ? " · checks" : ""}
                {review ? ` · review` : ""}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {running ? <StatusBadge status="building" />
                  : review ? <ToneBadge tone={verdict === "approve" ? "good" : verdict === "changes" ? "bad" : ""}>{{ approve: "approved", changes: "changes asked", unknown: "reviewed" }[verdict]}</ToneBadge>
                  : list[0] && list[0].status !== "done" ? <ToneBadge tone="bad">{list[0].status}</ToneBadge> : null}
                {roundCost(list) ? <span className="text-xs text-muted-foreground">{money(roundCost(list))}</span> : null}
              </span>
            </button>
            {roundIsOpen && <div className="flex flex-col gap-2 p-2">{list.map((r) => {
              const entries = r.status === "running" ? (live[r.id] ?? []) : (loaded[r.id] ?? live[r.id] ?? []);
              const runOpen = isOpen(r.id);
              return (
                <div key={r.id} className="overflow-hidden rounded-lg border bg-card">
                  <button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted" onClick={() => setOpen((m) => ({ ...m, [r.id]: !runOpen }))}>
                    {runOpen ? <ChevronDown /> : <ChevronRight />}
                    <b>{RUN_LABEL[r.kind] ?? r.kind}</b>
                    <span>{agentName(r.agent_id)}</span>
                    {r.model && <span className="font-mono text-xs text-muted-foreground">{r.model}</span>}
                    <span className="ml-auto flex items-center gap-2">
                      {r.status === "running" ? <StatusBadge status="building" /> : <ToneBadge tone={r.status === "done" ? "good" : "bad"}>{r.status}</ToneBadge>}
                      <span className="text-xs text-muted-foreground">{r.turns ?? "–"} {r.kind === "checks" ? "commands" : "turns"} · {r.seconds ?? "–"} s{r.cost_usd ? ` · ${money(r.cost_usd)}` : ""}</span>
                    </span>
                  </button>
                  {runOpen && (
                    entries.length ? <Steps entries={entries} showThinking={showThinking} />
                      : r.status === "running" ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Waiting for the first answer…</p>
                      : <pre className="m-2 max-h-80 overflow-auto rounded-lg bg-terminal p-3 font-mono text-xs whitespace-pre-wrap text-terminal-foreground">{r.log || "No step log for this run (it ran before step logging was added)."}</pre>
                  )}
                  {runOpen && r.status !== "running" && runError(r) && !entries.some((e) => e.kind === "error") && (
                    <div className="px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap text-destructive">✗ {runError(r)}</div>
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

function runError(r: Run) {
  const m = /^ERROR: ([^\n]*)/.exec(r.summary ?? "");
  return r.status === "done" ? "" : m?.[1] ?? "";
}

function reviewVerdict(r: Run): "approve" | "changes" | "unknown" {
  const m = /^Verdict: (\w+)/m.exec(r.summary ?? "");
  return m ? (m[1] === "approve" ? "approve" : "changes") : "unknown";
}

function roundCost(list: Run[]) {
  return list.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
}
