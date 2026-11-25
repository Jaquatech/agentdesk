/** Pure helpers for the Runs tab. */

export type RunStatus = "planned" | "running" | "done" | "stopped" | "failed" | "interrupted";

/** `$0.03`; under a cent four decimals; `-` when there is no figure. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  if (n === 0) return "$0";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/** The range of an estimate: `Free`, one figure when both ends read the same, else `$a - $b`. */
export function estimateRange(low: number, high: number): string {
  if (low === 0 && high === 0) return "Free";
  const a = formatUsd(low);
  const b = formatUsd(high);
  return a === b ? a : `${a} - ${b}`;
}

/** 0 to 100, 0 when there is nothing to do. */
export function progressPercent(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

const LABELS: Record<RunStatus, string> = {
  planned: "Planned", running: "Running", done: "Done", stopped: "Stopped", failed: "Failed", interrupted: "Interrupted",
};

export function statusLabel(status: string): string {
  return LABELS[status as RunStatus] ?? status;
}

/** Start is allowed when every model has a price, a cap is set where it is needed, and an estimate over the cap is confirmed. */
export function canStart(est: { missing: string[]; needs_cap: boolean; over_cap: boolean } | null | undefined, confirmOver: boolean): boolean {
  return !!est && est.missing.length === 0 && !est.needs_cap && (!est.over_cap || confirmOver);
}

/** Text cut to `max` characters for a table cell. */
export function clip(text: string, max = 160): { text: string; cut: boolean } {
  return text.length > max ? { text: text.slice(0, max) + "…", cut: true } : { text, cut: false };
}

/** Estimate against the real cost, in words, with a note when the estimate was too low. */
export function compareLine(estLow: number, estHigh: number, actual: number): string {
  let line = `Estimated ${estimateRange(estLow, estHigh)}, actual ${formatUsd(actual)}.`;
  if (estHigh === 0 && actual > 0) line += " The estimate was $0, but the run cost money: a price may be missing or out of date.";
  else if (actual > estHigh) line += " The actual cost is above the high estimate.";
  return line;
}
