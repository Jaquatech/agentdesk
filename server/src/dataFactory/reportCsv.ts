import type { RunReport } from "./report.ts";

export const CASE_COLUMNS = [
  "run_id", "run_name", "dataset", "version", "judge_model", "provider", "model", "case_key", "tags", "input", "expected", "answer",
  "status", "error", "tokens_in", "tokens_out", "cost_usd", "ms", "judge_status", "score", "pass", "judge_reason", "vote", "vote_note", "agrees",
] as const;

export type Cell = string | number | null;
const bool = (b: boolean | null): string | null => (b === null ? null : b ? "true" : "false");

/** One row per case, raw values (booleans as `true`/`false`); quoting and the formula guard are done by `reportCsv`. */
export function caseRows(report: RunReport): Cell[][] {
  return report.cases.map((c): Cell[] => [
    report.run.id, report.run.name, report.dataset.name, report.dataset.version, report.judge?.model ?? null, c.provider_name, c.model, c.case_key,
    c.tags.join(" "), c.input, c.expected, c.answer, c.status, c.error, c.tokens_in, c.tokens_out, c.cost_usd, c.ms,
    c.judge?.status ?? null, c.judge?.score ?? null, bool(c.judge?.pass ?? null), c.judge?.reason ?? null,
    c.vote?.verdict ?? null, c.vote?.note ?? null, bool(c.agrees),
  ]);
}

/** One CSV field: quoted when needed, with the formula guard. */
export function cell(v: Cell): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /["\r\n,;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportCsv(report: RunReport): string {
  const lines = [CASE_COLUMNS as readonly Cell[] as Cell[], ...caseRows(report)].map((r) => r.map(cell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
