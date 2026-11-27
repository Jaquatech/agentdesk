import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { caseLabel } from "./caseLabel.ts";
import { localTime } from "./localTime.ts";
import { percent, problems, seconds, type ReportCase, type RunReport } from "./report.ts";

const LIMIT = 100;

function Text({ children, label }: { children: string; label: string }) {
  return <pre role="group" aria-label={label} tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{children === "" ? "(empty)" : children}</pre>;
}

function CaseItem({ c, withReason }: { c: ReportCase; withReason: boolean }) {
  const reason = c.judge ? (c.judge.status === "error" ? c.judge.error : c.judge.reason) : "";
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b pb-3">
      <span className="text-sm font-medium">{caseLabel(c.case_key)} <span className="font-normal text-muted-foreground">({c.model}, {c.provider_name})</span></span>
      {c.status === "error" && <Text label="Error">{c.error}</Text>}
      {withReason && reason !== "" && <Text label="Judge reason">{reason}</Text>}
      {c.vote && <span className="text-xs text-muted-foreground">Your vote: {c.vote.verdict}{c.vote.note ? `, ${c.vote.note}` : ""}</span>}
    </li>
  );
}

function ProblemList({ title, cases, withReason }: { title: string; cases: ReportCase[]; withReason: boolean }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold">{title} ({cases.length})</h3>
      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cases.slice(0, LIMIT).map((c) => <CaseItem key={`${c.run_model_id}-${c.case_key}`} c={c} withReason={withReason} />)}
        </ul>
      )}
      {cases.length > LIMIT && <p className="text-sm text-muted-foreground">And {cases.length - LIMIT} more.</p>}
    </section>
  );
}

/** The report of one run, drawn from the report data (never from the Markdown, never as HTML). Sets no DOM ids: it is on the page twice. */
export function ReportView({ report, all }: { report: RunReport; all: boolean }) {
  const { run, dataset, judge } = report;
  const p = problems(report.cases);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="min-w-0 shrink-0">
        <CardHeader>
          <CardTitle><h2>{run.name || `Run ${run.id}`}</h2></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>Dataset: {dataset.name} v{dataset.version} ({dataset.case_count} cases)</p>
          <p>Status: {run.status}{run.stop_reason ? ` (${run.stop_reason})` : ""}</p>
          <p>Cost: ${run.cost_usd.toFixed(4)}</p>
          <p>Judge: {judge ? `${judge.model} (${judge.provider_name}), ${judge.status}` : "none"}</p>
          <p className="text-muted-foreground">Report made {localTime(report.generated_at)}</p>
          {run.system_prompt !== "" && (<><p className="mt-2 text-xs font-medium text-muted-foreground">System prompt</p><Text label="System prompt">{run.system_prompt}</Text></>)}
        </CardContent>
      </Card>
      <Card className="min-w-0 shrink-0">
        <CardHeader><CardTitle><h2>Models</h2></CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Answers</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Avg score</TableHead>
                <TableHead className="text-right">Pass rate</TableHead>
                <TableHead className="text-right">Good rate</TableHead>
                <TableHead className="text-right">Agreement</TableHead>
                <TableHead className="text-right">Avg time</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.models.map((m) => (
                <TableRow key={m.run_model_id}>
                  <TableCell>{m.model} <span className="text-muted-foreground">({m.provider_name})</span></TableCell>
                  <TableCell className="text-right">{m.answers}</TableCell>
                  <TableCell className="text-right">{m.errors}</TableCell>
                  <TableCell className="text-right">{m.avg_score === null ? "-" : m.avg_score.toFixed(1)}</TableCell>
                  <TableCell className="text-right">{percent(m.pass_rate)}</TableCell>
                  <TableCell className="text-right">{percent(m.good_rate)}</TableCell>
                  <TableCell className="text-right">{percent(m.agreement)}</TableCell>
                  <TableCell className="text-right">{seconds(m.avg_ms)}</TableCell>
                  <TableCell className="text-right">${m.cost_usd.toFixed(4)}{m.cost_unknown > 0 ? "*" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.models.some((m) => m.cost_unknown > 0) && <p className="mt-2 text-xs text-muted-foreground">* Some prices are unknown, so the cost is a lower bound.</p>}
        </CardContent>
      </Card>
      <Card className="min-w-0 shrink-0">
        <CardHeader><CardTitle><h2>Problems</h2></CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ProblemList title="Failed by the judge" cases={p.failed} withReason />
          <ProblemList title="Errors" cases={p.errors} withReason={false} />
          <ProblemList title="You and the judge disagree" cases={p.disagreements} withReason />
        </CardContent>
      </Card>
      {all && (
        <Card className="min-w-0 shrink-0">
          <CardHeader><CardTitle><h2>All answers ({report.cases.length})</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {report.cases.map((c) => (
              <div key={`${c.run_model_id}-${c.case_key}`} className="flex min-w-0 flex-col gap-1 border-b pb-3">
                <span className="text-sm font-medium">{caseLabel(c.case_key)} <span className="font-normal text-muted-foreground">({c.model}, {c.status})</span></span>
                <Text label="Question">{c.input}</Text>
                <Text label={c.status === "error" ? "Error" : "Answer"}>{c.status === "error" ? c.error : c.answer}</Text>
                {c.judge?.status === "ok" && <span className="text-xs text-muted-foreground">Judge: {c.judge.score ?? "-"}, {c.judge.pass ? "pass" : "fail"}. {c.judge.reason}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
