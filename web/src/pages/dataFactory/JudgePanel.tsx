import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { del, get, post, put, useLoad } from "../../api.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field } from "../../components/ui.tsx";
import { Choice, NoFillInput } from "../../components/inputs.tsx";
import { averageText, hasEnded, judgeableRuns, overallAverage, passRateText, type JudgeSummaryRow } from "./judge.ts";
import { JudgeResults } from "./JudgeResults.tsx";
import { JUDGE_EXAMPLES } from "./judgeExamples.ts";
import { localTime } from "./localTime.ts";
import { canStart, compareLine, estimateRange, formatUsd, progressPercent, statusLabel } from "./runs.ts";

type RunRow = { id: number; name: string; status: string; dataset_name: string; version: number };
type SummaryRow = JudgeSummaryRow & { run_model_id: number; provider_name: string; model: string };
type JudgeRow = {
  id: number; run_id: number; status: string; stop_reason: string | null; provider_name: string; model: string;
  cost_usd: number; cap_usd: number | null; est_low: number; est_high: number; created_at: string; ended_at: string | null;
  done_calls: number; error_calls: number; total_calls: number; summary: SummaryRow[];
};
type Rubric = { rubric: string; is_default: boolean; default_rubric: string; format_line: string };
type JudgeOption = { id: number; provider_id: number; provider_name: string; model: string; family: string; price_status: string; same_family: boolean };
type JudgeOptions = { models: JudgeOption[]; warning: string | null };
type JudgeEstimate = { calls: number; low: number; high: number; status: "priced" | "free" | "missing"; needs_cap: boolean; over_cap: boolean };
type RunDetail = { progress: { done_calls: number; error_calls: number } };
type Selection = { kind: "rubric" } | { kind: "new" } | { kind: "run"; id: number };

const MAX_RUBRIC = 4000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const runName = (r: { id: number; name: string }) => r.name || `Run ${r.id}`;
const tabLink = (projectId: number, tab: string) => `#/data-factory/${projectId}?tab=${tab}`;
const NEEDS_RUN = "Judging needs a finished run. Start one on the Runs tab.";

function StatusBadge({ status }: { status: string }) {
  const variant = status === "failed" ? "destructive" : status === "running" ? "default" : "secondary";
  return <Badge variant={variant}>{statusLabel(status)}</Badge>;
}

/** Judging of one project: the scoring guide, new judgings and the judge runs, as a narrow list and a wide view. */
export function JudgePanel({ projectId }: { projectId: number }) {
  const runs = useLoad<RunRow[]>(`/api/projects/${projectId}/runs`);
  const [sel, setSel] = useState<Selection>({ kind: "rubric" });
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const runList = runs.data ?? [];
  const ended = runList.filter((r) => hasEnded(r.status));
  const endedKey = ended.map((r) => r.id).join(",");

  // Requests: one for the runs, then one judge-runs call per ended run (a judge run only exists for an ended run).
  // The server has no list across a project's runs; at most 100 runs are listed, so this stays small.
  useEffect(() => {
    let live = true;
    const ids = endedKey === "" ? [] : endedKey.split(",").map(Number);
    Promise.all(ids.map((id) => get<JudgeRow[]>(`/api/eval-runs/${id}/judge-runs`)))
      .then((lists) => { if (live) { setJudges(lists.flat().sort((a, b) => b.id - a.id)); setListError(null); } })
      .catch((e) => { if (live) setListError(message(e)); });
    return () => { live = false; };
  }, [endedKey, tick]);

  const runOf = (id: number) => runList.find((r) => r.id === id);
  const openJudge = sel.kind === "run" ? judges.find((j) => j.id === sel.id) ?? null : null;
  const entry = "flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Judging" className="max-h-60 min-h-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
        <div className="border-b p-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => setSel({ kind: "new" })}><Plus /> New judging</Button>
        </div>
        <ul className="flex flex-col">
          <li className={cn("border-b hover:bg-accent/50", sel.kind === "rubric" && "bg-accent")} aria-current={sel.kind === "rubric" ? "true" : undefined}>
            <button type="button" className={entry} onClick={() => setSel({ kind: "rubric" })}>
              <span className="text-sm font-medium">Scoring guide</span>
              <span className="text-xs text-muted-foreground">How the judge scores answers</span>
            </button>
          </li>
          {judges.map((j) => {
            const on = sel.kind === "run" && sel.id === j.id;
            const run = runOf(j.run_id);
            return (
              <li key={j.id} className={cn("border-b hover:bg-accent/50", on && "bg-accent")} aria-current={on ? "true" : undefined}>
                <button type="button" className={entry} onClick={() => setSel({ kind: "run", id: j.id })}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{run ? runName(run) : `Run ${j.run_id}`}</span>
                    <StatusBadge status={j.status} />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{j.model}</span>
                  {j.status === "done" && <span className="text-xs text-muted-foreground">Average {overallAverage(j.summary)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {runs.data && ended.length === 0 && <p className="p-3 text-xs text-muted-foreground">{NEEDS_RUN}</p>}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto p-6">
        {runs.error && <p role="alert" className="text-sm text-destructive">{runs.error}</p>}
        {listError && <p role="alert" className="text-sm text-destructive">{listError}</p>}
        {sel.kind === "rubric" && <RubricView key={projectId} projectId={projectId} />}
        {sel.kind === "new" && (
          <NewJudging projectId={projectId} runs={ended} loaded={!!runs.data} onStarted={(id) => { setSel({ kind: "run", id }); reload(); }} />
        )}
        {openJudge && (
          <JudgeRunView key={openJudge.id} id={openJudge.id} runLabel={runOf(openJudge.run_id) ? runName(runOf(openJudge.run_id)!) : `Run ${openJudge.run_id}`}
            onChanged={reload} onDeleted={() => { setSel({ kind: "rubric" }); reload(); }} />
        )}
        {sel.kind === "run" && !openJudge && runs.data && <p className="text-sm text-muted-foreground">No such judge run.</p>}
      </div>
    </div>
  );
}

function RubricView({ projectId }: { projectId: number }) {
  const rubric = useLoad<Rubric>(`/api/projects/${projectId}/judge`);
  if (rubric.error) return <p role="alert" className="text-sm text-destructive">{rubric.error}</p>;
  if (!rubric.data) return null;
  return <RubricForm projectId={projectId} initial={rubric.data} />;
}

function RubricForm({ projectId, initial }: { projectId: number; initial: Rubric }) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial.rubric);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (next: string, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await put<Rubric>(`/api/projects/${projectId}/judge`, { rubric: next });
      setSaved(r);
      setText(r.rubric);
      setNote(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0 shrink-0">
        <CardHeader><CardTitle>Scoring guide</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <Field label="Scoring guide" hint={`${text.length} of ${MAX_RUBRIC} characters`}>
            <Textarea value={text} rows={16} maxLength={MAX_RUBRIC} className="min-h-80 max-h-[70vh] w-full resize-y"
              onChange={(e) => { setText(e.target.value); setNote(null); }} />
          </Field>
          {saved.is_default && <p role="status" className="text-muted-foreground">This is the default scoring guide.</p>}
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">The answer format is added automatically after your scoring guide and cannot be edited:</p>
            <p className="rounded-md bg-muted p-2 font-mono text-xs break-words">{saved.format_line}</p>
          </div>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {note && <p role="status">{note}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || text === saved.rubric} onClick={() => void save(text, "Saved.")}>Save</Button>
            {text !== saved.rubric && <Button variant="outline" disabled={busy} onClick={() => { setText(saved.rubric); setNote(null); }}>Discard changes</Button>}
            <Button variant="outline" disabled={busy || saved.is_default} onClick={() => void save("", "The default scoring guide is back.")}>Reset to default</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0 lg:sticky lg:top-0">
        <CardHeader><CardTitle>How it works</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <p>The judge sees the question, the reference answer (when the dataset has one) and the model&apos;s answer. You decide what counts as good.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Say what each score from 1 to 5 means.</li>
              <li>Say what pass means.</li>
              <li>Name what to ignore, such as wording or length.</li>
              <li>Keep it short: it is sent with every answer. About 4 characters make a token, so 400 characters is about 100 tokens per answer.</li>
            </ul>
            <p>The answer format line is added for you. A changed guide applies to new judgings only; earlier judge runs keep the text they used.</p>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Examples</h3>
            <ul className="flex flex-col gap-2">
              {JUDGE_EXAMPLES.map((ex) => (
                <li key={ex.id} className="flex flex-col gap-1 rounded-md border p-2">
                  <span className="font-medium">{ex.name}</span>
                  <span className="text-xs text-muted-foreground">{ex.when}</span>
                  <div><Button size="sm" variant="outline" aria-label={`Use this example: ${ex.name}`} onClick={() => { setText(ex.text); setNote(null); }}>Use this example</Button></div>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NewJudging({ projectId, runs, loaded, onStarted }: { projectId: number; runs: RunRow[]; loaded: boolean; onStarted: (id: number) => void }) {
  const [counts, setCounts] = useState<Record<number, number> | null>(null);
  const [runPick, setRunPick] = useState("");
  const [modelPick, setModelPick] = useState("");
  const [cap, setCap] = useState("");
  const [confirmOver, setConfirmOver] = useState(false);
  const [options, setOptions] = useState<{ runId: number; data: JudgeOptions } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [est, setEst] = useState<{ key: string; est: JudgeEstimate } | null>(null);
  const [estError, setEstError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The answer count of each ended run (the run list does not carry it): one detail call per ended run, only while this form is open.
  const endedKey = runs.map((r) => r.id).join(",");
  useEffect(() => {
    let live = true;
    const ids = endedKey === "" ? [] : endedKey.split(",").map(Number);
    Promise.all(ids.map((id) => get<RunDetail>(`/api/eval-runs/${id}`).then((d) => [id, d.progress.done_calls - d.progress.error_calls] as const)))
      .then((pairs) => { if (live) setCounts(Object.fromEntries(pairs)); })
      .catch((e) => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [endedKey]);

  const choices = judgeableRuns(runs.map((r) => ({ ...r, answers: counts?.[r.id] ?? 0 })));
  const run = choices.find((r) => String(r.id) === runPick) ?? choices[0] ?? null;
  const runId = run?.id ?? null;

  useEffect(() => {
    if (runId === null) return;
    let live = true;
    get<JudgeOptions>(`/api/eval-runs/${runId}/judge-options`)
      .then((d) => { if (live) { setOptions({ runId, data: d }); setOptionsError(null); } })
      .catch((e) => { if (live) setOptionsError(message(e)); });
    return () => { live = false; };
  }, [runId]);

  const opts = options && options.runId === runId ? options.data : null;
  const judge = opts ? opts.models.find((m) => String(m.id) === modelPick) ?? opts.models[0] ?? null : null;
  const capNum = cap.trim() === "" ? null : Number(cap);
  const capOk = capNum === null || (Number.isFinite(capNum) && capNum > 0);
  const input = runId !== null && judge && capOk ? { eval_model_id: judge.id, cap_usd: capNum } : null;
  const inputKey = `${runId}:${JSON.stringify(input)}`;
  const current = est && est.key === inputKey ? est.est : null;

  // Refresh the estimate about 400 ms after the last change; an older answer is dropped.
  useEffect(() => {
    if (!input || runId === null) return;
    let live = true;
    const t = setTimeout(() => {
      post<JudgeEstimate>(`/api/eval-runs/${runId}/judge/estimate`, input)
        .then((e) => { if (live) { setEst({ key: inputKey, est: e }); setEstError(null); } })
        .catch((e) => { if (live) { setEst(null); setEstError(message(e)); } });
    }, 400);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `inputKey` stands for `input` and the run
  }, [inputKey]);

  const start = async () => {
    if (!input || runId === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ id: number }>(`/api/eval-runs/${runId}/judge`, { ...input, confirm_over_cap: confirmOver });
      onStarted(r.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (loaded && runs.length === 0) return <p className="text-sm text-muted-foreground">{NEEDS_RUN}</p>;
  if (counts && choices.length === 0) return <p className="text-sm text-muted-foreground">No finished run has answers to judge. Start one on the Runs tab.</p>;
  const noJudge = opts !== null && opts.models.length === 0;

  return (
    <>
      <Card className="max-w-2xl shrink-0">
        <CardHeader><CardTitle>New judging</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <Field label="Run to judge">
            <Choice value={runId === null ? "" : String(runId)} onValueChange={(v) => { setRunPick(v); setModelPick(""); setConfirmOver(false); }}
              options={choices.map((r) => ({ value: String(r.id), label: `${runName(r)} - ${r.dataset_name} v${r.version} - ${r.answers} answers` }))} />
          </Field>
          {optionsError && <p role="alert" className="text-destructive">{optionsError}</p>}
          {noJudge && (
            <p>This project has no judge model. Tick &quot;Judge with this model&quot; for a model on the <a className="underline" href={tabLink(projectId, "models")}>Models</a> tab.</p>
          )}
          {opts && opts.warning && <p role="status">{opts.warning}</p>}
          {opts && opts.models.length > 0 && (
            <Field label="Judge model">
              <Choice value={judge ? String(judge.id) : ""} onValueChange={(v) => { setModelPick(v); setConfirmOver(false); }}
                options={opts.models.map((m) => ({ value: String(m.id), label: `${m.model} (${m.provider_name}, ${m.family})${m.same_family ? " - same family as a tested model" : ""}` }))} />
            </Field>
          )}
          {judge?.same_family && <div><Badge variant="outline">same family as a tested model</Badge></div>}
          <Field label="Cost cap (USD)" hint="Optional. Not needed for free models.">
            <NoFillInput type="number" min={0} step="any" value={cap} onChange={(e) => { setCap(e.target.value); setConfirmOver(false); }} />
          </Field>
        </CardContent>
      </Card>

      <Card className="max-w-2xl shrink-0">
        <CardHeader><CardTitle>Estimate</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {!capOk && <p className="text-destructive">The cost cap must be a number above 0, or empty for no cap.</p>}
          {!judge && !noJudge && <p className="text-muted-foreground">Choose a judge model.</p>}
          {input && estError && <p role="alert" className="text-destructive">{estError}</p>}
          {input && current && <JudgeEstimateView est={current} model={judge?.model ?? ""} confirmOver={confirmOver} onConfirm={setConfirmOver} />}
          <p className="text-xs text-muted-foreground">One judge call per answer. It is a range, not an exact figure.</p>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div><Button onClick={() => void start()} disabled={busy || !input || !canStart(current ? asRunEstimate(current, judge?.model ?? "") : null, confirmOver)}>Start judging</Button></div>
        </CardContent>
      </Card>
    </>
  );
}

/** The shape `canStart` reads: a missing price counts as a missing model. */
function asRunEstimate(e: JudgeEstimate, model: string) {
  return { missing: e.status === "missing" ? [model] : [], needs_cap: e.needs_cap, over_cap: e.over_cap };
}

function JudgeEstimateView({ est, model, confirmOver, onConfirm }: { est: JudgeEstimate; model: string; confirmOver: boolean; onConfirm: (v: boolean) => void }) {
  return (
    <>
      <p className="font-medium">{est.calls} judge calls: {est.status === "missing" ? "No price" : estimateRange(est.low, est.high)}</p>
      {est.status === "missing" && <p role="status">No price for {model}. Set it on the Models tab (enter 0 and 0 if the model is free).</p>}
      {est.needs_cap && <p role="status">Set a cost cap: this judge model is paid.</p>}
      {est.over_cap && (
        <div role="status" className="flex flex-col gap-2">
          <p>The estimate can go over your cap.</p>
          <label className="flex items-center gap-2"><Checkbox checked={confirmOver} onCheckedChange={(v) => onConfirm(v === true)} /> Start anyway</label>
        </div>
      )}
    </>
  );
}

function JudgeRunView({ id, runLabel, onChanged, onDeleted }: { id: number; runLabel: string; onChanged: () => void; onDeleted: () => void }) {
  const [judge, setJudge] = useState<JudgeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"stop" | "delete" | null>(null);

  const load = useCallback(() => get<JudgeRow>(`/api/judge-runs/${id}`).then((r) => { setJudge(r); return r; }), [id]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);

  // Poll every 2 seconds while running; leaving the tab or the end of the run clears the timer.
  const status = judge?.status;
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => { load().then((r) => { if (r.status !== "running") onChanged(); }).catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [status, load, onChanged]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(message(e)); }
  };
  const stop = () => act(async () => { await post(`/api/judge-runs/${id}/stop`); await load(); onChanged(); });
  const remove = () => act(async () => { await del(`/api/judge-runs/${id}`); onDeleted(); });

  if (!judge) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;
  const running = judge.status === "running";

  return (
    <>
      <Card className="max-w-3xl shrink-0">
        <CardHeader><CardTitle className="flex items-center gap-2 break-all">{runLabel} <StatusBadge status={judge.status} /></CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Run</dt><dd className="break-all">{runLabel}</dd>
            <dt className="text-muted-foreground">Judge model</dt><dd className="break-all">{judge.model} ({judge.provider_name})</dd>
            <dt className="text-muted-foreground">Created</dt><dd>{localTime(judge.created_at)}</dd>
            <dt className="text-muted-foreground">Cost</dt><dd>{formatUsd(judge.cost_usd)}{judge.cap_usd !== null && <> of a {formatUsd(judge.cap_usd)} cap</>}</dd>
          </dl>
          {running ? (
            <div className="flex flex-col gap-2">
              <progress className="h-2 w-full accent-primary" aria-label="Progress" value={progressPercent(judge.done_calls, judge.total_calls)} max={100} />
              <p>{judge.done_calls} of {judge.total_calls} answers judged, {judge.error_calls} errors</p>
              <p>Estimate {estimateRange(judge.est_low, judge.est_high)}.</p>
              <div><Button variant="destructive" onClick={() => setDialog("stop")}>Stop</Button></div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {judge.stop_reason && <p>{judge.stop_reason}</p>}
              <p>{judge.done_calls} of {judge.total_calls} answers judged, {judge.error_calls} errors.</p>
              <p>{compareLine(judge.est_low, judge.est_high, judge.cost_usd)}</p>
              <div><Button variant="outline" onClick={() => setDialog("delete")}>Delete</Button></div>
            </div>
          )}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {judge.summary.length > 0 && (
        <Table className="max-w-3xl">
          <TableHeader>
            <TableRow><TableHead>Model</TableHead><TableHead>Judged</TableHead><TableHead>Average score</TableHead><TableHead>Pass rate</TableHead><TableHead>Errors</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {judge.summary.map((s) => (
              <TableRow key={s.run_model_id}>
                <TableCell className="whitespace-normal break-all">{s.model}</TableCell>
                <TableCell>{s.judged}</TableCell>
                <TableCell>{averageText(s.avg_score, s.judged)}</TableCell>
                <TableCell>{passRateText(s.pass_rate, s.judged)}</TableCell>
                <TableCell>{s.errors}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <JudgeResults judgeId={id} models={judge.summary} doneCalls={judge.done_calls} />

      <AlertDialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog === "stop" ? "Stop this judging?" : "Delete this judging?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "stop" ? "Calls that are already sent are paid for. The judgements so far are kept." : "The judge run and its judgements are removed. The run and its answers stay."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { const d = dialog; setDialog(null); void (d === "stop" ? stop() : remove()); }}>
              {dialog === "stop" ? "Stop" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
