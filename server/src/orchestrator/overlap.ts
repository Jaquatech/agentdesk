/**
 * Tasks of one sprint that may change the same files must not run at the same time: the later one would not see the
 * earlier one's work (and the two would conflict when they merge into the sprint branch).
 */

/** "./src\\x/" → "src/x"; a wildcard path is cut at the first wildcard ("src/*.js" → "src"); "" means the whole project. */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");
  const w = s.search(/[*?[]/);
  if (w >= 0) s = s.slice(0, s.lastIndexOf("/", w) >= 0 ? s.lastIndexOf("/", w) : 0);
  s = s.replace(/\/+$/, "");
  return s === "." ? "" : s;
}

const covers = (outer: string, inner: string) => outer === "" || inner === outer || inner.startsWith(outer + "/");

/** True when any path of one list is the same as, inside or around a path of the other. */
export function pathsOverlap(a: string[], b: string[]): boolean {
  const x = a.map(normalizePath), y = b.map(normalizePath);
  return x.some((p) => y.some((q) => covers(p, q) || covers(q, p)));
}

/** A blocker that has stopped and needs the user (a different message than a blocker that is just working). */
export const isStuck = (status: string) => ["needs_attention", "failed", "interrupted"].includes(status);

/** One chat message per blocker, and one more if it stops: the key must not change with the blocker's other statuses. */
export const waitKey = (taskId: number, blocker: { id: number; status: string }) => `${taskId}:wait:${blocker.id}:${isStuck(blocker.status)}`;

export type PlanningTask = { id: number; title: string; status: string; paths: string; sprint_id: number | null };

const WORKING = ["building", "verifying", "reviewing"];

/**
 * The task of the same sprint that this one has to wait for, if any: one that is working on the same files right now
 * (whatever its place in the backlog; it cannot be stopped to make room), or an earlier one that is not finished yet.
 * Merged and cancelled tasks never block.
 */
export function blockingTask(task: PlanningTask, all: PlanningTask[], parse: (s: string) => string[]): PlanningTask | undefined {
  if (!task.sprint_id) return undefined;
  const mine = parse(task.paths);
  if (!mine.length) return undefined;
  return all.find((o) => o.id !== task.id && o.sprint_id === task.sprint_id && !["merged", "cancelled"].includes(o.status) && (o.id < task.id || WORKING.includes(o.status)) && pathsOverlap(mine, parse(o.paths)));
}
