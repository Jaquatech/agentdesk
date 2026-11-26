import writeXlsxFile from "write-excel-file/node";
import type { Cell as XCell } from "write-excel-file/node";
import type { RunReport } from "./report.ts";
import { CASE_COLUMNS, caseRows } from "./reportCsv.ts";

type Value = string | number | null;
const MAX_CELL = 32767;
const CUT = "… (cut)";
const bad = (c: number) => c <= 8 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f);

/** Control characters out, and text over the cell limit cut to end with a note. */
export function cleanText(s: string): string {
  let t = "";
  for (let i = 0; i < s.length; i++) if (!bad(s.charCodeAt(i))) t += s[i];
  return t.length > MAX_CELL ? t.slice(0, MAX_CELL - CUT.length) + CUT : t;
}


function cell(v: Value, extra: { format?: string; fontWeight?: "bold" } = {}): XCell {
  if (v === null) return null;
  if (typeof v === "number") return { value: v, type: Number, ...extra };
  return { value: cleanText(v), type: String, ...extra };
}
const bold = (v: string): XCell => cell(v, { fontWeight: "bold" });
const rate = (v: number | null): XCell => cell(v, { format: "0%" });

/** The run report as a workbook: Summary, Models, Cases. Text is always stored as text, never as a formula. */
export async function reportXlsx(report: RunReport): Promise<Buffer> {
  const r = report.run;
  const summary: [string, Value][] = [
    ["Run", `${r.name} (#${r.id})`], ["Dataset", report.dataset.name], ["Version", report.dataset.version], ["Cases", report.dataset.case_count],
    ["Status", r.status], ["Started", r.started_at], ["Ended", r.ended_at],
    ["Judge", report.judge ? `${report.judge.provider_name} / ${report.judge.model}` : null], ["Max answer tokens", r.max_tokens],
    ["Cost of tested models", r.cost_usd], ["Cost of judging", report.judge?.cost_usd ?? null], ["Estimate low", r.est_low], ["Estimate high", r.est_high],
    ["System prompt", r.system_prompt], ["Scoring guide", report.judge?.rubric ?? null],
  ];
  const modelHeader = ["Provider", "Model", "Answers", "Errors", "Missing", "Pass rate", "Avg score", "Good rate", "Agreement", "Avg ms", "p95 ms",
    "Tokens in", "Tokens out", "Cost USD", "Results without cost", "Judged by same family"];
  const models: XCell[][] = report.models.map((m) => [
    cell(m.provider_name), cell(m.model), cell(m.answers), cell(m.errors), cell(m.missing), rate(m.pass_rate), cell(m.avg_score), rate(m.good_rate),
    rate(m.agreement), cell(m.avg_ms), cell(m.p95_ms), cell(m.tokens_in), cell(m.tokens_out), cell(m.cost_usd), cell(m.cost_unknown),
    cell(m.self_preference ? "yes" : "no"),
  ]);
  const cases: XCell[][] = caseRows(report).map((row) => row.map((v) => cell(v)));
  return writeXlsxFile([
    { data: summary.map(([k, v]) => [bold(k), cell(v)]), sheet: "Summary", columns: [{ width: 28 }, { width: 80 }] },
    { data: [modelHeader.map(bold), ...models], sheet: "Models", columns: modelHeader.map((h) => ({ width: Math.max(12, h.length + 2) })) },
    { data: [CASE_COLUMNS.map(bold), ...cases], sheet: "Cases", columns: CASE_COLUMNS.map((h) => ({ width: Math.max(12, h.length + 2) })) },
  ]).toBuffer();
}
