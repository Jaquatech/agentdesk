import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { del, get, post, useLoad } from "../../api.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field } from "../../components/ui.tsx";
import { Choice, NoFillInput } from "../../components/inputs.tsx";
import { localTime } from "./localTime.ts";
import { priceLine, type PriceStatus } from "./models.ts";
import { RunResults } from "./RunResults.tsx";
import { runName, RUNS_CHANGED } from "./sidebarRuns.ts";
import { canStart, compareLine, estimateRange, formatUsd, progressPercent, statusLabel } from "./runs.ts";

type RunRow = {
  id: number; name: string; status: string; dataset_name: string; version: number; est_low: number; est_high: number; cost_usd: number;
};
type ModelRow = {
  id: number; model: string; provider_name: string; for_test: number;
  price_status: PriceStatus; price_in: number | null; price_out: number | null; cache_read: number | null; cache_write: number | null;
};
type DatasetRow = { id: number; name: string };
type DatasetDetail = { id: number; versions: { id: number; version: number; case_count: number }[] };
type Estimate = {
  models: { provider_name: string; model: string; status: PriceStatus; low: number; high: number }[];
  low: number; high: number; missing: string[]; needs_cap: boolean; over_cap: boolean;
};
type Run = RunRow & {
  stop_reason: string | null; case_count: number; system_prompt: string; max_tokens: number; cap_usd: number | null;
  created_at: string; started_at: string | null; ended_at: string | null;
  models: { id: number; provider_name: string; model: string }[]; estimate: Estimate;
  progress: { total_calls: number; done_calls: number; error_calls: number; cost_usd: number };
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const tabLink = (projectId: number, tab: string) => `#/data-factory/${projectId}?tab=${tab}`;
const runLink = (projectId: number, id: number) => `${tabLink(projectId, "runs")}&run=${id}`;
const announce = () => window.dispatchEvent(new Event(RUNS_CHANGED));

function StatusBadge({ status }: { status: string }) {
  const variant = status === "failed" ? "destructive" : status === "running" ? "default" : "secondary";
  return <Badge variant={variant}>{statusLabel(status)}</Badge>;
}

/** Runs of one project: the narrow list, the new-run form or the open run. */
export function RunsPanel({ projectId, run }: { projectId: number; run?: number }) {
  const list = useLoad<RunRow[]>(`/api/projects/${projectId}/runs`);
  const openId = run ?? null;
  const [creating, setCreating] = useState(false);
  // The open run lives in the address: choosing one (here or in the sidebar) closes the new-run form.
  const [seenRun, setSeenRun] = useState(run);
  if (seenRun !== run) { setSeenRun(run); if (run !== undefined) setCreating(false); }
  const goRun = (id: number | null) => { window.location.hash = id === null ? tabLink(projectId, "runs") : runLink(projectId, id); };
  const changed = () => { list.reload(); announce(); };
  const rows = list.data ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Runs" className="max-h-60 min-h-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
        <div className="border-b p-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => { setCreating(true); goRun(null); }}><Plus /> New run</Button>
        </div>
        {rows.length > 0 && (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id} className={cn("border-b hover:bg-accent/50", !creating && openId === r.id && "bg-accent")} aria-current={!creating && openId === r.id ? "true" : undefined}>
                <button type="button" className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset" onClick={() => { setCreating(false); goRun(r.id); }}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{runName(r)}</span>
                    <StatusBadge status={r.status} />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{r.dataset_name} v{r.version}</span>
                  <span className="text-xs text-muted-foreground">{formatUsd(r.cost_usd)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto p-6">
        {list.error && <p className="text-sm text-destructive">{list.error}</p>}
        {rows.length === 0 && list.data && !creating && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">No runs yet.</p>
            <Button size="sm" onClick={() => setCreating(true)}><Plus /> New run</Button>
          </div>
        )}
        {creating && (
          <NewRun projectId={projectId} onPlanned={changed} onStarted={(id) => { setCreating(false); goRun(id); changed(); }} />
        )}
        {!creating && open && (
          <RunView key={open.id} id={open.id} onChanged={changed} onDeleted={() => { goRun(null); changed(); }} />
        )}
        {!creating && openId !== null && !open && list.data && <p className="text-sm text-muted-foreground">No such run.</p>}
      </div>
    </div>
  );
}

function NewRun({ projectId, onPlanned, onStarted }: { projectId: number; onPlanned: () => void; onStarted: (id: number) => void }) {
  const datasets = useLoad<DatasetRow[]>(`/api/projects/${projectId}/datasets`);
  const models = useLoad<ModelRow[]>(`/api/projects/${projectId}/models`);
  const [datasetPick, setDatasetPick] = useState("");
  const [versionPick, setVersionPick] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [prompt, setPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState("512");
  const [cap, setCap] = useState("");
  const [name, setName] = useState("");
  const [confirmOver, setConfirmOver] = useState(false);
  const [est, setEst] = useState<Estimate | null>(null);
  const [estError, setEstError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const datasetList = datasets.data ?? [];
  const datasetId = datasetList.find((d) => String(d.id) === datasetPick)?.id ?? datasetList[0]?.id ?? null;
  const detail = useLoad<DatasetDetail>(datasetId === null ? null : `/api/datasets/${datasetId}`);
  const versions = detail.data && detail.data.id === datasetId ? detail.data.versions : [];
  const versionId = versions.find((v) => String(v.id) === versionPick)?.id ?? versions[0]?.id ?? null;
  const testModels = (models.data ?? []).filter((m) => m.for_test === 1);
  const chosen = picked.filter((id) => testModels.some((m) => m.id === id));

  const tokens = Number(maxTokens);
  const tokensOk = maxTokens.trim() !== "" && Number.isInteger(tokens) && tokens >= 16 && tokens <= 8192;
  const capNum = cap.trim() === "" ? null : Number(cap);
  const capOk = capNum === null || (Number.isFinite(capNum) && capNum > 0);
  const input = tokensOk && capOk && versionId !== null && chosen.length > 0 ? {
    version_id: versionId, model_ids: chosen, system_prompt: prompt, max_tokens: tokens, cap_usd: capNum, name,
  } : null;
  const inputKey = JSON.stringify(input);

  // Refresh the estimate about 400 ms after the last change.
  useEffect(() => {
    if (!input) return;
    let live = true;
    const t = setTimeout(() => {
      post<Estimate>(`/api/projects/${projectId}/runs/estimate`, input)
        .then((e) => { if (live) { setEst(e); setEstError(null); } })
        .catch((e) => { if (live) { setEst(null); setEstError(message(e)); } });
    }, 400);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `inputKey` stands for `input`
  }, [projectId, inputKey]);

  const start = async () => {
    if (!input) return;
    setBusy(true);
    setError(null);
    let id: number | null = null;
    try {
      id = (await post<{ id: number }>(`/api/projects/${projectId}/runs`, input)).id;
      await post(`/api/eval-runs/${id}/start`, { confirm_over_cap: confirmOver });
      onStarted(id);
    } catch (e) {
      if (id !== null) { onPlanned(); setError(`The run was planned but did not start: ${message(e)} Open it in the list to start it.`); }
      else setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (datasets.data && datasetList.length === 0) {
    return <p className="text-sm text-muted-foreground">This project has no datasets. Add one on the <a className="underline" href={tabLink(projectId, "import")}>Import</a> tab.</p>;
  }
  if (models.data && testModels.length === 0) {
    return <p className="text-sm text-muted-foreground">This project has no models to test with. Add one on the <a className="underline" href={tabLink(projectId, "models")}>Models</a> tab.</p>;
  }

  return (
    <>
      <Card className="max-w-2xl shrink-0">
        <CardHeader><CardTitle>New run</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dataset">
              <Choice value={datasetId === null ? "" : String(datasetId)} onValueChange={(v) => { setDatasetPick(v); setVersionPick(""); }}
                options={datasetList.map((d) => ({ value: String(d.id), label: d.name }))} />
            </Field>
            <Field label="Version">
              <Choice value={versionId === null ? "" : String(versionId)} onValueChange={setVersionPick}
                options={versions.map((v) => ({ value: String(v.id), label: `v${v.version} (${v.case_count} cases)` }))} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Models</legend>
            {testModels.map((m) => (
              <label key={m.id} className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={chosen.includes(m.id)}
                  onCheckedChange={(v) => setPicked(v === true ? [...chosen, m.id] : chosen.filter((x) => x !== m.id))} />
                <span className="min-w-0">
                  <span className="break-all">{m.model}</span> <span className="text-muted-foreground">({m.provider_name})</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.price_status === "missing" ? "No price set. Set it on the Models tab (0 and 0 if free)." : priceLine(m)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="System prompt (optional)"><Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={8000} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Answer length cap (tokens)" hint="16 to 8192"><NoFillInput type="number" min={16} max={8192} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} /></Field>
            <Field label="Cost cap (USD)" hint="Optional. Not needed for free models."><NoFillInput type="number" min={0} step="any" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
            <Field label="Name (optional)"><NoFillInput value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl shrink-0">
        <CardHeader><CardTitle>Estimate</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {!tokensOk && <p className="text-destructive">The answer length cap must be a whole number from 16 to 8192.</p>}
          {!capOk && <p className="text-destructive">The cost cap must be a number above 0, or empty for no cap.</p>}
          {chosen.length === 0 && <p className="text-muted-foreground">Choose at least one model.</p>}
          {input && estError && <p role="alert" className="text-destructive">{estError}</p>}
          {input && est && <EstimateView est={est} confirmOver={confirmOver} onConfirm={setConfirmOver} />}
          <p className="text-xs text-muted-foreground">
            Estimate = cases x tokens x price. Input is the system prompt plus each case; output is somewhere between the expected answer&apos;s length and your answer cap. It is a range, not an exact figure.
          </p>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div><Button onClick={() => void start()} disabled={busy || !input || !canStart(est, confirmOver)}>Start run</Button></div>
        </CardContent>
      </Card>
    </>
  );
}

function EstimateView({ est, confirmOver, onConfirm }: { est: Estimate; confirmOver: boolean; onConfirm: (v: boolean) => void }) {
  return (
    <>
      <p className="font-medium">Whole run: {estimateRange(est.low, est.high)}</p>
      <ul className="flex flex-col gap-1">
        {est.models.map((m) => (
          <li key={`${m.provider_name}/${m.model}`} className="flex justify-between gap-3">
            <span className="break-all">{m.model}</span>
            <span>{m.status === "missing" ? "No price" : estimateRange(m.low, m.high)}</span>
          </li>
        ))}
      </ul>
      {est.missing.length > 0 && <p role="status">No price for {est.missing.join(", ")}. Set it on the Models tab (enter 0 and 0 if the model is free).</p>}
      {est.needs_cap && <p role="status">Set a cost cap: this run uses paid models.</p>}
      {est.over_cap && (
        <div role="status" className="flex flex-col gap-2">
          <p>The estimate can go over your cap.</p>
          <label className="flex items-center gap-2"><Checkbox checked={confirmOver} onCheckedChange={(v) => onConfirm(v === true)} /> Start anyway</label>
        </div>
      )}
      {est.high > 0 && <p className="text-xs text-muted-foreground">To bring the cost down: use fewer cases, a smaller model, or a lower answer cap.</p>}
    </>
  );
}

function RunView({ id, onChanged, onDeleted }: { id: number; onChanged: () => void; onDeleted: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOver, setConfirmOver] = useState(false);
  const [dialog, setDialog] = useState<"stop" | "delete" | null>(null);

  const load = useCallback(() => get<Run>(`/api/eval-runs/${id}`).then((r) => { setRun(r); return r; }), [id]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);

  // Poll every 2 seconds while running; leaving the tab or the end of the run clears the timer.
  const status = run?.status;
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => { load().then((r) => { if (r.status !== "running") onChanged(); }).catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [status, load, onChanged]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(message(e)); }
  };
  const start = () => act(async () => { await post(`/api/eval-runs/${id}/start`, { confirm_over_cap: confirmOver }); await load(); onChanged(); });
  const stop = () => act(async () => { await post(`/api/eval-runs/${id}/stop`); await load(); onChanged(); });
  const remove = () => act(async () => { await del(`/api/eval-runs/${id}`); onDeleted(); });

  if (!run) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;
  const p = run.progress;
  const ended = run.status !== "planned" && run.status !== "running";
  const resultModels = run.models.map((m) => ({ ...m, free: run.estimate.models.find((e) => e.model === m.model && e.provider_name === m.provider_name)?.status === "free" }));

  return (
    <>
      <Card className="max-w-3xl shrink-0">
        <CardHeader><CardTitle className="flex items-center gap-2 break-all">{runName(run)} <StatusBadge status={run.status} /></CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Dataset</dt><dd>{run.dataset_name} v{run.version} ({run.case_count} cases)</dd>
            <dt className="text-muted-foreground">Models</dt><dd className="break-all">{run.models.map((m) => m.model).join(", ")}</dd>
            <dt className="text-muted-foreground">Created</dt><dd>{localTime(run.created_at)}</dd>
            {run.started_at && <><dt className="text-muted-foreground">Started</dt><dd>{localTime(run.started_at)}</dd></>}
            <dt className="text-muted-foreground">Answer length cap</dt><dd>{run.max_tokens} tokens</dd>
          </dl>

          {run.status === "running" && (
            <div className="flex flex-col gap-2">
              <progress className="h-2 w-full accent-primary" aria-label="Progress" value={progressPercent(p.done_calls, p.total_calls)} max={100} />
              <p>{p.done_calls} of {p.total_calls} answers, {p.error_calls} errors</p>
              <p>
                Cost so far {formatUsd(p.cost_usd)}{run.cap_usd !== null && <> of a {formatUsd(run.cap_usd)} cap</>}. Estimate {estimateRange(run.estimate.low, run.estimate.high)}.
              </p>
              <div><Button variant="destructive" onClick={() => setDialog("stop")}>Stop</Button></div>
            </div>
          )}

          {run.status === "planned" && (
            <div className="flex flex-col gap-3">
              <p>Planned, not started. Estimate {estimateRange(run.estimate.low, run.estimate.high)}{run.cap_usd !== null && <>, cost cap {formatUsd(run.cap_usd)}</>}.</p>
              <EstimateView est={run.estimate} confirmOver={confirmOver} onConfirm={setConfirmOver} />
              <div className="flex gap-2">
                <Button onClick={() => void start()} disabled={!canStart(run.estimate, confirmOver)}>Start</Button>
                <Button variant="outline" onClick={() => setDialog("delete")}>Delete</Button>
              </div>
            </div>
          )}

          {ended && (
            <div className="flex flex-col gap-2">
              {run.stop_reason && <p>{run.stop_reason}</p>}
              <p>{p.done_calls} of {p.total_calls} answers, {p.error_calls} errors.</p>
              <p>{compareLine(run.est_low, run.est_high, run.cost_usd)}</p>
              <p className="text-xs text-muted-foreground">Estimates get better as you compare them with real runs.</p>
              <div><Button variant="outline" onClick={() => setDialog("delete")}>Delete</Button></div>
            </div>
          )}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {run.status !== "planned" && <RunResults runId={id} models={resultModels} doneCalls={p.done_calls} />}

      <AlertDialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog === "stop" ? "Stop this run?" : "Delete this run?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "stop" ? "Calls that are already sent are paid for. The answers so far are kept." : "The run and its answers are removed."}
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
