export const SIDEBAR_RUNS = 5;

/** Window event: a run was planned, started, stopped, deleted or finished; the sidebar list reloads. */
export const RUNS_CHANGED = "eval-runs-changed";

export const runName = (r: { id: number; name: string }) => r.name || `Run ${r.id}`;

/** The newest runs for the sidebar (the server returns newest first) and whether any of them is running. */
export function latestRuns<T extends { status: string }>(rows: T[], max = SIDEBAR_RUNS): { shown: T[]; running: boolean } {
  const shown = rows.slice(0, max);
  return { shown, running: shown.some((r) => r.status === "running") };
}
