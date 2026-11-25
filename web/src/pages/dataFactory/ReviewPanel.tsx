import { useCallback, useEffect, useRef, useState } from "react";
import { del, get, put, useLoad } from "../../api.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field } from "../../components/ui.tsx";
import { Choice } from "../../components/inputs.tsx";
import { hasEnded } from "./judge.ts";
import {
  agreementSentence, agreementWord, defaultVoteFilter, judgeLabel, modelShown, nextAfterSkip, nextAfterVote, percentText, previousVoted, progressLine,
  readHideModels, saveHideModels, voteLabel, VOTE_FILTERS, type VoteFilter,
} from "./review.ts";

type RunRow = { id: number; name: string; status: string; dataset_name: string; version: number };
type Vote = { verdict: "good" | "bad"; note: string };
type Judge = { score: number | null; pass: boolean; reason: string; judge_model: string };
type ReviewItem = {
  result_id: number; case_key: string; provider_name: string; model: string; input: string; answer: string;
  vote: Vote | null; expected: string | null; judge: Judge | null; agrees: boolean | null;
};
type ReviewPage = { total: number; voted: number; items: ReviewItem[] };
type VotesPage = { total: number; items: ReviewItem[] };
type Counts = { answers: number; voted: number; good: number; bad: number; compared: number; agree: number };
type ModelSummary = Counts & { run_model_id: number; provider_name: string; model: string; good_rate: number | null; agreement: number | null };
type Summary = Counts & { good_rate: number | null; agreement: number | null; models: ModelSummary[] };

const PAGE = 100;
const MAX_NOTE = 500;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const runName = (r: { id: number; name: string }) => r.name || `Run ${r.id}`;
const EMPTY = "Reviewing needs answers. Run a test on the Runs tab.";

/** Blind review of one project: runs with answers as a narrow list, one answer at a time in the wide view. */
export function ReviewPanel({ projectId }: { projectId: number }) {
  const runs = useLoad<RunRow[]>(`/api/projects/${projectId}/runs`);
  const [summaries, setSummaries] = useState<Record<number, Summary>>({});
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const ended = (runs.data ?? []).filter((r) => hasEnded(r.status));
  const endedKey = ended.map((r) => r.id).join(",");

  // One summary call per ended run; the server has no list across runs and at most 100 runs are listed.
  useEffect(() => {
    if (!runs.data) return;
    let live = true;
    const ids = endedKey === "" ? [] : endedKey.split(",").map(Number);
    Promise.all(ids.map((id) => get<Summary>(`/api/eval-runs/${id}/review-summary`).then((s) => [id, s] as const)))
      .then((pairs) => { if (live) { setSummaries(Object.fromEntries(pairs)); setListError(null); setLoaded(true); } })
      .catch((e) => { if (live) { setListError(message(e)); setLoaded(true); } });
    return () => { live = false; };
  }, [runs.data, endedKey, tick]);

  const withAnswers = ended.filter((r) => (summaries[r.id]?.answers ?? 0) > 0);
  const open = withAnswers.find((r) => r.id === sel) ?? null;
  const entry = "flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Runs to review" className="max-h-60 min-h-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
        <ul className="flex flex-col">
          {withAnswers.map((r) => {
            const on = r.id === sel;
            const s = summaries[r.id];
            return (
              <li key={r.id} className={cn("border-b hover:bg-accent/50", on && "bg-accent")} aria-current={on ? "true" : undefined}>
                <button type="button" className={entry} onClick={() => setSel(r.id)}>
                  <span className="truncate text-sm font-medium">{runName(r)}</span>
                  <span className="truncate text-xs text-muted-foreground">{r.dataset_name} v{r.version}</span>
                  <span className="text-xs text-muted-foreground">voted {s.voted} of {s.answers}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {loaded && withAnswers.length === 0 && <p className="p-3 text-xs text-muted-foreground">{EMPTY}</p>}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto p-6">
        {runs.error && <p role="alert" className="text-sm text-destructive">{runs.error}</p>}
        {listError && <p role="alert" className="text-sm text-destructive">{listError}</p>}
        {open ? (
          <ReviewView key={open.id} runId={open.id} summary={summaries[open.id]} projectId={projectId} onChanged={reload} />
        ) : (
          loaded && withAnswers.length > 0 && <p className="text-sm text-muted-foreground">Choose a run to review.</p>
        )}
      </div>
    </div>
  );
}

function ReviewView({ runId, summary, projectId, onChanged }: { runId: number; summary: Summary; projectId: number; onChanged: () => void }) {
  const [modelPick, setModelPick] = useState("");
  const [unvotedOnly, setUnvotedOnly] = useState(true);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [session, setSession] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideModels, setHideModels] = useState(readHideModels);
  const [votesTick, setVotesTick] = useState(0);
  const focusRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef(false);

  // The answers of this view are fetched once per filter change and kept in order, so Next never lands on the answer just voted.
  useEffect(() => {
    let live = true;
    (async () => {
      const all: ReviewItem[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const q = `limit=${PAGE}&offset=${offset}&unvoted=${unvotedOnly ? 1 : 0}${modelPick ? `&model=${modelPick}` : ""}`;
        const page = await get<ReviewPage>(`/api/eval-runs/${runId}/review?${q}`);
        all.push(...page.items);
        if (page.items.length < PAGE) break;
      }
      return all;
    })()
      .then((all) => { if (live) { setItems(all); setCursor(all.length > 0 ? 0 : null); setSession([]); setError(null); setReady(true); } })
      .catch((e) => { if (live) { setError(message(e)); setReady(true); } });
    return () => { live = false; };
  }, [runId, modelPick, unvotedOnly]);

  useEffect(() => {
    if (focusNext.current) { focusNext.current = false; focusRef.current?.focus(); }
  }, [cursor]);

  const voted = items.map((i) => i.vote !== null);
  const inSession = items.map((i) => session.includes(i.result_id));
  const row = modelPick ? summary.models.find((m) => String(m.run_model_id) === modelPick) : undefined;
  const counts = row ?? summary;
  const here = cursor === null ? null : items[cursor] ?? null;
  const prev = previousVoted(inSession, cursor ?? items.length);

  const replace = (item: ReviewItem) => setItems((list) => list.map((i) => (i.result_id === item.result_id ? item : i)));
  const go = (i: number | null) => { focusNext.current = true; setCursor(i); };

  const vote = async (item: ReviewItem, verdict: "good" | "bad", note: string): Promise<boolean> => {
    setError(null);
    try {
      replace(await put<ReviewItem>(`/api/eval-results/${item.result_id}/vote`, { verdict, note }));
      setSession((s) => (s.includes(item.result_id) ? s : [...s, item.result_id]));
      setVotesTick((n) => n + 1);
      onChanged();
      return true;
    } catch (e) { setError(message(e)); return false; }
  };
  const remove = async (item: ReviewItem): Promise<boolean> => {
    setError(null);
    try {
      await del(`/api/eval-results/${item.result_id}/vote`);
      replace({ ...item, vote: null, expected: null, judge: null, agrees: null });
      setVotesTick((n) => n + 1);
      onChanged();
      return true;
    } catch (e) { setError(message(e)); return false; }
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <p className="text-sm font-medium">{progressLine(counts.voted, counts.answers)}</p>
        <div className="w-64">
          <Field label="Model">
            <Choice value={modelPick} onValueChange={setModelPick}
              options={[{ value: "", label: "All models" }, ...summary.models.map((m) => ({ value: String(m.run_model_id), label: `${m.model} (${m.provider_name})` }))]} />
          </Field>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox checked={unvotedOnly} onCheckedChange={(v) => setUnvotedOnly(v === true)} /> Unvoted only
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox checked={hideModels} onCheckedChange={(v) => { setHideModels(v === true); saveHideModels(v === true); }} /> Hide model names while voting
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {ready && here && (
        <AnswerCard key={here.result_id} item={here} focusRef={focusRef} projectId={projectId} hideModels={hideModels}
          previous={prev !== null ? () => go(prev) : null}
          onVote={(verdict, note) => vote(here, verdict, note)}
          onRemove={() => remove(here)}
          onSkip={() => go(nextAfterSkip(voted, cursor!, unvotedOnly))}
          onNext={() => go(nextAfterVote(voted, cursor!, unvotedOnly))} />
      )}
      {ready && !here && (
        <Card className="min-w-0 shrink-0">
          <CardHeader><CardTitle><h2>{counts.voted >= counts.answers ? "All answers in this view are voted." : "No more answers in this view."}</h2></CardTitle></CardHeader>
          {prev !== null && <CardContent><Button ref={focusRef} variant="outline" onClick={() => go(prev)}>Previous</Button></CardContent>}
        </Card>
      )}
      <SummaryCard summary={summary} />
      <VotesCard runId={runId} modelPick={modelPick} refresh={votesTick} />
    </>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Textarea readOnly aria-label={label} value={text === "" ? "(empty)" : text} rows={Math.min(12, Math.max(3, text.split("\n").length))} className="max-h-96 bg-muted/30" />
    </div>
  );
}

function AnswerCard({ item, focusRef, projectId, hideModels, previous, onVote, onRemove, onSkip, onNext }: {
  item: ReviewItem; focusRef: React.RefObject<HTMLButtonElement | null>; projectId: number; hideModels: boolean; previous: (() => void) | null;
  onVote: (verdict: "good" | "bad", note: string) => Promise<boolean>; onRemove: () => Promise<boolean>; onSkip: () => void; onNext: () => void;
}) {
  const [note, setNote] = useState(item.vote?.note ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revealed = item.vote !== null;
  const run = async (fn: () => Promise<boolean>, done: string) => {
    setBusy(true);
    setSaved(null);
    const ok = await fn();
    setSaved(ok ? done : null);
    setBusy(false);
  };
  const sentence = agreementSentence(item.agrees);

  return (
    <Card className="min-w-0 shrink-0">
      <CardHeader>
        <CardTitle>
          <h2>Case {item.case_key}</h2>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{modelShown(hideModels, revealed, item.model, item.provider_name)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <Block label="Question" text={item.input} />
        <Block label="Answer" text={item.answer} />
        {!revealed && <p className="text-muted-foreground">The reference answer and the judge&apos;s score show after you vote.</p>}
        <Field label="Note (optional)" hint={`${note.length} of ${MAX_NOTE} characters`}>
          <Textarea value={note} rows={2} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {previous && <Button variant="outline" disabled={busy} onClick={previous}>Previous</Button>}
          <Button ref={revealed ? undefined : focusRef} disabled={busy} variant={item.vote?.verdict === "good" ? "default" : "outline"} onClick={() => run(() => onVote("good", note), "Vote saved: good.")}>Good</Button>
          <Button disabled={busy} variant={item.vote?.verdict === "bad" ? "default" : "outline"} onClick={() => run(() => onVote("bad", note), "Vote saved: bad.")}>Bad</Button>
          {revealed ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => run(onRemove, "Vote removed.")}>Remove vote</Button>
              <Button ref={focusRef} disabled={busy} onClick={onNext}>Next</Button>
            </>
          ) : (
            <Button variant="outline" disabled={busy} onClick={onSkip}>Skip</Button>
          )}
        </div>
        <p role="status" className="text-muted-foreground">{saved}</p>
        {revealed && (
          <div className="flex flex-col gap-3 border-t pt-4">
            <Block label="Reference answer" text={item.expected ?? "(none)"} />
            {item.judge ? (
              <div className="flex flex-col gap-1">
                <p>Judge score: {item.judge.score ?? "-"}, {item.judge.pass ? "pass" : "fail"} ({item.judge.judge_model})</p>
                <p className="text-muted-foreground">{item.judge.reason}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No judge run covers this answer. Start one on the <a className="underline" href={`#/data-factory/${projectId}?tab=judge`}>Judge tab</a>.
              </p>
            )}
            {sentence && <p className="font-medium">{sentence}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const VOTES_PAGE = 50;
const VOTE_FILTER_OPTIONS = VOTE_FILTERS.map((f) => ({ value: f.value, label: f.label }));

/** The human votes of one run next to the judge's verdict; a row opens to the full answers. */
function VotesCard({ runId, modelPick, refresh }: { runId: number; modelPick: string; refresh: number }) {
  const [filter, setFilter] = useState<VoteFilter | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const count = useRef(0);
  useEffect(() => { count.current = items.length; }, [items.length]);
  const base = `/api/eval-runs/${runId}/review-votes`;
  const modelQ = modelPick ? `&model=${modelPick}` : "";

  // Opens on the disagreements when there are any.
  useEffect(() => {
    let live = true;
    get<VotesPage>(`${base}?agreement=disagree&limit=1`)
      .then((p) => { if (live) setFilter((f) => f ?? defaultVoteFilter(p.total)); })
      .catch(() => { if (live) setFilter((f) => f ?? "all"); });
    return () => { live = false; };
  }, [base]);

  // Reloads after every vote, keeping as many rows as were shown.
  useEffect(() => {
    if (filter === null) return;
    let live = true;
    const limit = Math.min(200, Math.max(VOTES_PAGE, count.current));
    get<VotesPage>(`${base}?agreement=${filter}&limit=${limit}&offset=0${modelQ}`)
      .then((p) => { if (live) { setItems(p.items); setTotal(p.total); setError(null); setLoaded(true); } })
      .catch((e) => { if (live) { setError(message(e)); setLoaded(true); } });
    return () => { live = false; };
  }, [base, filter, modelQ, refresh]);

  const showMore = async () => {
    if (filter === null) return;
    setMore(true);
    try {
      const p = await get<VotesPage>(`${base}?agreement=${filter}&limit=${VOTES_PAGE}&offset=${items.length}${modelQ}`);
      setItems((list) => [...list, ...p.items.filter((n) => !list.some((i) => i.result_id === n.result_id))]);
      setTotal(p.total);
    } catch (e) { setError(message(e)); }
    setMore(false);
  };

  return (
    <Card className="min-w-0 shrink-0">
      <CardHeader><CardTitle>Your votes</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="w-48">
          <Field label="Agreement with the judge">
            <Choice value={filter ?? "all"} onValueChange={(v) => { setFilter(v as VoteFilter); setOpenId(null); }} options={VOTE_FILTER_OPTIONS} />
          </Field>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {loaded && items.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">{filter === "all" && !modelPick ? "No votes yet." : "No votes match this filter."}</p>
        )}
        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Your vote</TableHead>
                <TableHead>Judge</TableHead>
                <TableHead>Agreement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => {
                const open = openId === i.result_id;
                const panel = `vote-detail-${i.result_id}`;
                const toggle = () => setOpenId(open ? null : i.result_id);
                return (
                  <VoteRows key={i.result_id} item={i} open={open} panel={panel} toggle={toggle} />
                );
              })}
            </TableBody>
          </Table>
        )}
        {items.length < total && (
          <div><Button variant="outline" disabled={more} onClick={showMore}>Show more results</Button></div>
        )}
      </CardContent>
    </Card>
  );
}

function VoteRows({ item, open, panel, toggle }: { item: ReviewItem; open: boolean; panel: string; toggle: () => void }) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={toggle}>
        <TableCell className="whitespace-nowrap">
          <button type="button" aria-expanded={open} aria-controls={panel} className="text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={(e) => { e.stopPropagation(); toggle(); }}>
            {item.case_key}
          </button>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <span className="block max-w-56 truncate" title={`${item.model} (${item.provider_name})`}>{item.model}</span>
        </TableCell>
        <TableCell className="whitespace-nowrap">{voteLabel(item.vote?.verdict)}</TableCell>
        <TableCell className="whitespace-nowrap">{judgeLabel(item.judge)}</TableCell>
        <TableCell className="whitespace-nowrap">{agreementWord(item.agrees)}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell id={panel} colSpan={5} className="whitespace-normal">
            <div className="flex flex-col gap-3 py-2">
              <Block label="Question" text={item.input} />
              <Block label="Answer" text={item.answer} />
              <Block label="Reference answer" text={item.expected ?? "(none)"} />
              <Block label={`Your vote: ${voteLabel(item.vote?.verdict)}`} text={item.vote?.note ?? ""} />
              {item.judge ? (
                <>
                  <Block label={`Judge: ${judgeLabel(item.judge)} (${item.judge.judge_model})`} text={item.judge.reason} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No judge run covers this answer.</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SummaryCard({ summary }: { summary: Summary }) {
  return (
    <Card className="min-w-0 shrink-0">
      <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Answers</TableHead>
              <TableHead className="text-right">Voted</TableHead>
              <TableHead className="text-right">Good rate</TableHead>
              <TableHead className="text-right">Compared with judge</TableHead>
              <TableHead className="text-right">Agreement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.models.map((m) => (
              <TableRow key={m.run_model_id}>
                <TableCell>{m.model} <span className="text-muted-foreground">({m.provider_name})</span></TableCell>
                <TableCell className="text-right">{m.answers}</TableCell>
                <TableCell className="text-right">{m.voted}</TableCell>
                <TableCell className="text-right">{percentText(m.good_rate)}</TableCell>
                <TableCell className="text-right">{m.compared}</TableCell>
                <TableCell className="text-right">{percentText(m.agreement)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
