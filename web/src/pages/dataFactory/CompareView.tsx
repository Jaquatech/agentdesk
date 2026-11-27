import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "../../components/ui.tsx";
import { Choice } from "../../components/inputs.tsx";
import { CASE_FILTERS, changeWord, countsText, filterCases, type CaseFilter, type CompareCaseSide, type CompareSide, type Comparison, type Pair, type PairCase } from "./compare.ts";
import { percent, seconds } from "./report.ts";

const LIMIT = 100;
const runName = (r: { id: number; name: string }) => r.name || `Run ${r.id}`;
const score = (n: number | null) => (n === null ? "-" : n.toFixed(2));

function Text({ children }: { children: string }) {
  return <pre tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2 text-xs">{children === "" ? "(empty)" : children}</pre>;
}

function Part({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Text>{text}</Text>
    </div>
  );
}

const answerOf = (s: CompareCaseSide) => (s.status === "missing" ? "(no answer)" : s.answer);

function CaseRows({ c, open, panel, toggle }: { c: PairCase; open: boolean; panel: string | undefined; toggle: (() => void) | null }) {
  return (
    <>
      <TableRow className={toggle ? "cursor-pointer" : undefined} onClick={toggle ?? undefined}>
        <TableCell className="whitespace-nowrap">
          {toggle ? (
            <button type="button" aria-expanded={open} aria-controls={panel} className="text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={(e) => { e.stopPropagation(); toggle(); }}>
              {c.case_key}
            </button>
          ) : c.case_key}
        </TableCell>
        <TableCell className="whitespace-nowrap">{changeWord(c.change)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{score(c.a.score)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{score(c.b.score)}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell id={panel} colSpan={4} className="whitespace-normal">
            <div className="flex flex-col gap-3 py-2">
              <Part label="Input" text={c.input} />
              <Part label="Expected" text={c.expected ?? "(none)"} />
              <Part label="Answer A" text={answerOf(c.a)} />
              <Part label="Answer B" text={answerOf(c.b)} />
              <Part label="Judge reason A" text={c.a.reason} />
              <Part label="Judge reason B" text={c.b.reason} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Figures({ pair }: { pair: Pair }) {
  const row = (name: string, s: CompareSide) => (
    <TableRow>
      <TableCell>{name}</TableCell>
      <TableCell className="text-right">{s.answers}</TableCell>
      <TableCell className="text-right">{s.errors}</TableCell>
      <TableCell className="text-right">{percent(s.pass_rate)}</TableCell>
      <TableCell className="text-right">{score(s.avg_score)}</TableCell>
      <TableCell className="text-right">{percent(s.good_rate)}</TableCell>
      <TableCell className="text-right">{seconds(s.avg_ms)}</TableCell>
      <TableCell className="text-right">${s.cost_usd.toFixed(4)}</TableCell>
    </TableRow>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead className="text-right">Answers</TableHead>
          <TableHead className="text-right">Errors</TableHead>
          <TableHead className="text-right">Pass rate</TableHead>
          <TableHead className="text-right">Avg score</TableHead>
          <TableHead className="text-right">Good rate</TableHead>
          <TableHead className="text-right">Avg time</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{row("A", pair.a)}{row("B", pair.b)}</TableBody>
    </Table>
  );
}

function PairSection({ pair, index, filter, print }: { pair: Pair; index: number; filter: CaseFilter; print: boolean }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = filterCases(pair.cases, filter);
  const shown = rows.slice(0, LIMIT);
  return (
    <Card className="min-w-0 shrink-0">
      <CardHeader><CardTitle>{pair.label}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Figures pair={pair} />
        <p className="text-sm">{countsText(pair.counts)}</p>
        {pair.changed_input > 0 && <p className="text-sm text-muted-foreground">{pair.changed_input} cases have different input in the two runs and are not compared.</p>}
        {pair.only_a_cases > 0 && <p className="text-sm text-muted-foreground">{pair.only_a_cases} cases are only in run A.</p>}
        {pair.only_b_cases > 0 && <p className="text-sm text-muted-foreground">{pair.only_b_cases} cases are only in run B.</p>}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cases here.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Change</TableHead>
                <TableHead className="text-right">Score A</TableHead>
                <TableHead className="text-right">Score B</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => {
                const open = print || openKey === c.case_key;
                return (
                  <CaseRows key={c.case_key} c={c} open={open} panel={print ? undefined : `cmp-${index}-${c.case_key}`}
                    toggle={print ? null : () => setOpenKey(open ? null : c.case_key)} />
                );
              })}
            </TableBody>
          </Table>
        )}
        {rows.length > LIMIT && <p className="text-sm text-muted-foreground">And {rows.length - LIMIT} more (download the CSV).</p>}
      </CardContent>
    </Card>
  );
}

/** Two runs compared, drawn from the compare data (never from the Markdown, never as HTML). The print copy sets no DOM ids and opens every row. */
export function CompareView({ compare, filter, onFilter, print = false }: {
  compare: Comparison; filter: CaseFilter; onFilter?: (f: CaseFilter) => void; print?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>A: {runName(compare.a.run)}</span>
        <span>B: {runName(compare.b.run)}</span>
      </div>
      {compare.warnings.length > 0 && (
        <div className="rounded-md border p-3">
          <ul className="list-disc pl-5 text-sm">
            {compare.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
      {onFilter && !print && (
        <div className="w-56 max-w-full">
          <Field label="Show cases">
            <Choice value={filter} onValueChange={(v) => onFilter(v as CaseFilter)} options={CASE_FILTERS} />
          </Field>
        </div>
      )}
      {compare.pairs.map((p, i) => <PairSection key={p.label} pair={p} index={i} filter={filter} print={print} />)}
      {(compare.only_a.length > 0 || compare.only_b.length > 0) && (
        <div className="flex flex-col gap-1 text-sm">
          {compare.only_a.length > 0 && <p>Only in run A: {compare.only_a.join(", ")}</p>}
          {compare.only_b.length > 0 && <p>Only in run B: {compare.only_b.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
