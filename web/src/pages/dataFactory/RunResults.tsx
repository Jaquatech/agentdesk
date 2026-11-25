import { useEffect, useState } from "react";
import { get } from "../../api.ts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Choice } from "../../components/inputs.tsx";
import { clip, formatUsd } from "./runs.ts";

type ResultRow = {
  id: number; run_model_id: number; case_key: string | null; input: string; model: string; provider_name: string;
  answer: string | null; status: string; error: string | null; tokens_in: number | null; tokens_out: number | null; cost_usd: number | null; ms: number | null;
};
export type ResultModel = { id: number; provider_name: string; model: string; free: boolean };

const PAGE = 50;

/** The answers of a run: a model filter, 50 rows per page. Text is shown as text. */
export function RunResults({ runId, models, doneCalls }: { runId: number; models: ResultModel[]; doneCalls: number }) {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = (offset: number) => `/api/eval-runs/${runId}/results?limit=${PAGE}&offset=${offset}${filter ? `&model=${filter}` : ""}`;

  // The first page again when the filter changes or the run has new answers.
  useEffect(() => {
    let live = true;
    get<ResultRow[]>(url(0))
      .then((r) => { if (live) { setRows(r); setMore(r.length === PAGE); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `url` is built from runId and filter
  }, [runId, filter, doneCalls]);

  const loadMore = async () => {
    try {
      const r = await get<ResultRow[]>(url(rows.length));
      setRows((old) => [...old, ...r]);
      setMore(r.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const free = (r: ResultRow) => models.find((m) => m.model === r.model && m.provider_name === r.provider_name)?.free === true;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">Answers</h2>
        <div className="w-64">
          <Choice label="Model filter" value={filter} onValueChange={setFilter}
            options={[{ value: "", label: "All models" }, ...models.map((m) => ({ value: String(m.id), label: m.model }))]} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows.length === 0 && !error && <p className="text-sm text-muted-foreground">No answers yet.</p>}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead><TableHead>Model</TableHead><TableHead>Input</TableHead><TableHead>Answer</TableHead>
              <TableHead>Tokens in/out</TableHead><TableHead>Cost</TableHead><TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => <Row key={r.id} row={r} free={free(r)} />)}
          </TableBody>
        </Table>
      )}
      {more && <div><Button variant="outline" size="sm" onClick={() => void loadMore()}>Load more</Button></div>}
    </div>
  );
}

function Row({ row: r, free }: { row: ResultRow; free: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = r.status === "error";
  const answer = failed ? `Error: ${r.error ?? "unknown"}` : (r.answer ?? "");
  const input = clip(r.input);
  const out = clip(answer);
  const cut = input.cut || out.cut;
  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-nowrap">{r.case_key ?? ""}</TableCell>
      <TableCell className="max-w-56 truncate whitespace-nowrap" title={r.model}>{r.model}</TableCell>
      <TableCell className="whitespace-pre-wrap break-words">{open ? r.input : input.text}</TableCell>
      <TableCell className={failed ? "whitespace-pre-wrap break-words text-destructive" : "whitespace-pre-wrap break-words"}>
        {open ? <div className="max-h-96 overflow-auto">{answer}</div> : out.text}
        {cut && <div><Button variant="link" size="sm" className="h-auto p-0" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</Button></div>}
      </TableCell>
      <TableCell>{r.tokens_in ?? "-"} / {r.tokens_out ?? "-"}</TableCell>
      <TableCell>{free ? "Free" : formatUsd(r.cost_usd)}</TableCell>
      <TableCell>{r.ms === null ? "-" : `${(r.ms / 1000).toFixed(1)} s`}</TableCell>
    </TableRow>
  );
}
