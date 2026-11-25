import { useEffect, useState } from "react";
import { get } from "../../api.ts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Choice } from "../../components/inputs.tsx";
import { scoreLabel, verdictFrom, verdictLabel, verdictQuery } from "./judge.ts";
import { clip } from "./runs.ts";

type JudgementRow = {
  result_id: number; case_key: string | null; model: string; provider_name: string; input: string; expected: string | null; answer: string | null;
  score: number | null; pass: number | null; reason: string | null; status: string; error: string | null; cost_usd: number | null;
};
export type JudgeResultModel = { run_model_id: number; model: string };

const PAGE = 50;
const TEXT = "min-w-40 whitespace-pre-wrap break-words";

/** The judgements of a judge run: a model filter, a Pass / Fail / All filter, 50 rows per page. Text is shown as text. */
export function JudgeResults({ judgeId, models, doneCalls }: { judgeId: number; models: JudgeResultModel[]; doneCalls: number }) {
  const [filter, setFilter] = useState("");
  const [verdict, setVerdict] = useState("all");
  const [rows, setRows] = useState<JudgementRow[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = (offset: number) => `/api/judge-runs/${judgeId}/results?limit=${PAGE}&offset=${offset}${filter ? `&model=${filter}` : ""}${verdictQuery(verdict)}`;

  // The first page again when a filter changes or the judge run has new judgements.
  useEffect(() => {
    let live = true;
    get<JudgementRow[]>(url(0))
      .then((r) => { if (live) { setRows(r); setMore(r.length === PAGE); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `url` is built from judgeId and the filters
  }, [judgeId, filter, verdict, doneCalls]);

  const loadMore = async () => {
    try {
      const r = await get<JudgementRow[]>(url(rows.length));
      setRows((old) => [...old, ...r]);
      setMore(r.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">Judgements</h2>
        <div className="w-64">
          <Choice label="Model filter" value={filter} onValueChange={setFilter}
            options={[{ value: "", label: "All models" }, ...models.map((m) => ({ value: String(m.run_model_id), label: m.model }))]} />
        </div>
        <div className="w-40">
          <Choice label="Verdict filter" value={verdict} onValueChange={(v) => setVerdict(verdictFrom(v))}
            options={[{ value: "all", label: "All" }, { value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows.length === 0 && !error && <p className="text-sm text-muted-foreground">No judgements yet.</p>}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead><TableHead>Model</TableHead><TableHead>Input</TableHead><TableHead>Expected</TableHead>
              <TableHead>Answer</TableHead><TableHead>Score</TableHead><TableHead>Verdict</TableHead><TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => <Row key={r.result_id} row={r} />)}
          </TableBody>
        </Table>
      )}
      {more && <div><Button variant="outline" size="sm" onClick={() => void loadMore()}>Show more results</Button></div>}
    </div>
  );
}

function Row({ row: r }: { row: JudgementRow }) {
  const [open, setOpen] = useState(false);
  const failed = r.status === "error";
  const reason = failed ? `Error: ${r.error ?? "unknown"}` : (r.reason ?? "");
  const cells = [clip(r.input), clip(r.expected ?? ""), clip(r.answer ?? ""), clip(reason)];
  const cut = cells.some((c) => c.cut);
  const full = [r.input, r.expected ?? "", r.answer ?? "", reason];
  const show = (i: number) => (open ? <div className="max-h-96 overflow-auto">{full[i]}</div> : cells[i].text);
  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-nowrap">{r.case_key ?? ""}</TableCell>
      <TableCell className="max-w-56 truncate whitespace-nowrap" title={r.model}>{r.model}</TableCell>
      <TableCell className={`${TEXT} w-1/4`}>{show(0)}</TableCell>
      <TableCell className={`${TEXT} w-1/4`}>{show(1)}</TableCell>
      <TableCell className={`${TEXT} w-1/4`}>{show(2)}</TableCell>
      <TableCell className="whitespace-nowrap">{scoreLabel(r.score)}</TableCell>
      <TableCell className="whitespace-nowrap">{verdictLabel(r.status, r.pass)}</TableCell>
      <TableCell className={failed ? `${TEXT} w-1/4 text-destructive` : `${TEXT} w-1/4`}>
        {show(3)}
        {cut && <div><Button variant="link" size="sm" className="h-auto p-0" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</Button></div>}
      </TableCell>
    </TableRow>
  );
}
