import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCopy, Code, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { get, useLoad } from "../../api.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Field } from "../../components/ui.tsx";
import { Choice } from "../../components/inputs.tsx";
import { hasEnded } from "./judge.ts";
import { localTime } from "./localTime.ts";
import { fenced, reportUrl, unvoted, type ReportResponse } from "./report.ts";
import { ReportView } from "./ReportView.tsx";
import { CompareView } from "./CompareView.tsx";
import { compareUrl, orderSides, type CaseFilter, type CompareResponse } from "./compare.ts";

type RunRow = { id: number; name: string; status: string; dataset_name: string; version: number };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const runName = (r: { id: number; name: string }) => r.name || `Run ${r.id}`;
const EMPTY = "Reports need a finished run. Run a test on the Runs tab.";

/** Reports of one project: ended runs as a narrow list, the report of the chosen run in the wide view. */
export function ReportsPanel({ projectId }: { projectId: number }) {
  const runs = useLoad<RunRow[]>(`/api/projects/${projectId}/runs`);
  const [sel, setSel] = useState<number | null>(null);
  const ended = (runs.data ?? []).filter((r) => hasEnded(r.status));
  const open = ended.find((r) => r.id === sel) ?? null;
  const entry = "flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Runs with a report" className="max-h-60 min-h-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
        <ul className="flex flex-col">
          {ended.map((r) => {
            const on = r.id === sel;
            return (
              <li key={r.id} className={cn("border-b hover:bg-accent/50", on && "bg-accent")} aria-current={on ? "true" : undefined}>
                <button type="button" className={entry} onClick={() => setSel(r.id)}>
                  <span className="truncate text-sm font-medium">{runName(r)}</span>
                  <span className="truncate text-xs text-muted-foreground">{r.dataset_name} v{r.version}</span>
                  <span className="text-xs text-muted-foreground">{r.status}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {runs.data && ended.length === 0 && <p className="p-3 text-xs text-muted-foreground">{EMPTY}</p>}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto p-6">
        {runs.error && <p role="alert" className="text-sm text-destructive">{runs.error}</p>}
        {open ? (
          <RunReportView key={open.id} runId={open.id} projectId={projectId} others={ended.filter((r) => r.id !== open.id)} />
        ) : (
          ended.length > 0 && <p className="text-sm text-muted-foreground">Choose a run.</p>
        )}
      </div>
    </div>
  );
}

function RunReportView({ runId, projectId, others }: { runId: number; projectId: number; others: RunRow[] }) {
  const [other, setOther] = useState("");
  const [swapped, setSwapped] = useState(false);
  const [judgeA, setJudgeA] = useState<string | null>(null);
  const [judgeB, setJudgeB] = useState<string | null>(null);
  const [filter, setFilter] = useState<CaseFilter>("changed");
  const [cmp, setCmp] = useState<CompareResponse | null>(null);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const sides = other === "" ? null : orderSides(runId, Number(other), swapped);
  const sideA = sides?.a ?? null;
  const sideB = sides?.b ?? null;
  const [judgePick, setJudgePick] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The report is fetched with the chosen judging; the Markdown is only used for copying.
  useEffect(() => {
    let live = true;
    const q = `${judgePick ? `judge=${judgePick}&` : ""}all=${all ? 1 : 0}`;
    get<ReportResponse>(`/api/eval-runs/${runId}/report?${q}`)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [runId, judgePick, all]);

  // The comparison is fetched with the chosen judging of each side.
  useEffect(() => {
    if (sideA === null || sideB === null) return;
    let live = true;
    const q = `a=${sideA}&b=${sideB}${judgeA ? `&judge_a=${judgeA}` : ""}${judgeB ? `&judge_b=${judgeB}` : ""}`;
    get<CompareResponse>(`/api/eval-compare?${q}`)
      .then((d) => { if (live) { setCmp(d); setCmpError(null); } })
      .catch((e) => { if (live) { setCmp(null); setCmpError(message(e)); } });
    return () => { live = false; };
  }, [sideA, sideB, judgeA, judgeB]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const say = (text: string) => {
    setCopied(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 3000);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      say("Copied");
    } catch { say("Copy failed"); }
  };

  if (!data) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;

  const { report, markdown, judge_runs } = data;
  const judgeId = judgePick ? Number(judgePick) : report.judge?.id ?? null;
  const comparing = sides && cmp && cmp.compare.a.run.id === sides.a && cmp.compare.b.run.id === sides.b ? cmp : null;
  const jA = judgeA ? Number(judgeA) : comparing?.compare.a.judge?.id ?? null;
  const jB = judgeB ? Number(judgeB) : comparing?.compare.b.judge?.id ?? null;
  const url = (ext: string) => (sides ? compareUrl(ext, sides.a, sides.b, jA, jB) : reportUrl(runId, ext, judgeId, all));
  const markdownText = comparing ? comparing.markdown : markdown;
  const pickOther = (v: string) => { setOther(v === "none" ? "" : v); setSwapped(false); setJudgeA(null); setJudgeB(null); setCmp(null); setCmpError(null); };
  const judgeOptions = (list: { id: number; model: string; created_at: string; status: string }[]) =>
    list.map((j) => ({ value: String(j.id), label: `${j.model} · ${localTime(j.created_at)} · ${j.status}` }));  const missing = unvoted(report);
  const link = "inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

  return (
    <>
      <Card className="min-w-0 shrink-0">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-80 max-w-full">
              <Field label="Compare with">
                <Choice value={other === "" ? "none" : other} onValueChange={pickOther}
                  options={[{ value: "none", label: "None" }, ...others.map((r) => ({ value: String(r.id), label: `${runName(r)} · ${r.dataset_name} v${r.version}` }))]} />
              </Field>
            </div>
            {sides && (
              <Button variant="outline" size="sm" onClick={() => { setSwapped(!swapped); setJudgeA(null); setJudgeB(null); setCmp(null); }}>Swap A and B</Button>
            )}
            {comparing && (
              <>
                <div className="w-80 max-w-full">
                  <Field label="Judging of A">
                    <Choice value={String(jA ?? "")} onValueChange={setJudgeA} options={judgeOptions(comparing.judge_runs_a)} />
                  </Field>
                </div>
                <div className="w-80 max-w-full">
                  <Field label="Judging of B">
                    <Choice value={String(jB ?? "")} onValueChange={setJudgeB} options={judgeOptions(comparing.judge_runs_b)} />
                  </Field>
                </div>
              </>
            )}
            {!sides && judge_runs.length > 0 && (
              <div className="w-96 max-w-full">
                <Field label="Judging">
                  <Choice value={String(judgeId ?? "")} onValueChange={(v) => setJudgePick(v)}
                    options={judge_runs.map((j) => ({ value: String(j.id), label: `${j.model} · ${localTime(j.created_at)} · ${j.status}` }))} />
                </Field>
              </div>
            )}
            {!sides && (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} /> Include every answer in the Markdown
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(markdownText)}><ClipboardCopy /> Copy Markdown</Button>
            <Button variant="outline" size="sm" onClick={() => copy(fenced(markdownText))}><Code /> Copy as code block</Button>
            <a className={link} href={url("md")} download><Download className="size-4" /> .md</a>
            <a className={link} href={url("csv")} download><FileText className="size-4" /> CSV</a>
            <a className={link} href={url("xlsx")} download><FileSpreadsheet className="size-4" /> Excel</a>
            <a className={link} href={url("json")} download><Download className="size-4" /> JSON</a>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
            <span role="status" className="text-sm text-muted-foreground">{copied}</span>
          </div>
        </CardContent>
      </Card>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sides && cmpError && <p role="alert" className="text-sm text-destructive">{cmpError}</p>}
      {sides && comparing && (
        <>
          <CompareView compare={comparing.compare} filter={filter} onFilter={setFilter} />
          {createPortal(<div className="print-root"><CompareView compare={comparing.compare} filter={filter} print /></div>, document.body)}
        </>
      )}
      {!sides && missing > 0 && (
        <p className="text-sm text-muted-foreground">
          {missing} answers are not voted yet. This page shows judge scores, so vote on the Review tab first if you want a blind review.{" "}
          <a className="underline" href={`#/data-factory/${projectId}?tab=review`}>Review tab</a>
        </p>
      )}
      {!sides && <ReportView report={report} all={all} />}
      {!sides && createPortal(<div className="print-root"><ReportView report={report} all={all} /></div>, document.body)}
    </>
  );
}
