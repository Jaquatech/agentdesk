import type { FastifyInstance } from "fastify";
import type { DB } from "./db.ts";
import { getSettings } from "./db.ts";

/**
 * Spending limits. Two optional caps, set in Settings (0 = no limit):
 *  - per day: what all agent calls cost since midnight (local time)
 *  - per sprint: what one sprint cost, refinement of its items included
 * Only calls that have finished are counted, so a call in progress can take a day or sprint a little past its limit.
 * Calls whose cost is unknown (a model with no price, a local model) count as $0.
 */
type Bar = { spent: number; limit: number; over: boolean; warn: boolean };

const limitOf = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const bar = (spent: number, limit: number): Bar => ({ spent, limit, over: limit > 0 && spent >= limit, warn: limit > 0 && spent >= limit * 0.8 });

export function daySpend(db: DB) {
  return (db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS n FROM runs WHERE engine != 'shell' AND date(started_at, 'localtime') = date('now', 'localtime')`).get() as { n: number }).n;
}

export function sprintSpend(db: DB, sprintId: number) {
  return (db.prepare(`SELECT COALESCE(SUM(r.cost_usd), 0) AS n FROM runs r LEFT JOIN backlog_items b ON b.id = r.item_id
    WHERE r.engine != 'shell' AND COALESCE(r.sprint_id, b.sprint_id) = ?`).get(sprintId) as { n: number }).n;
}

export function budgetStatus(db: DB, sprintId?: number | null) {
  const s = getSettings(db);
  return {
    day: bar(daySpend(db), limitOf(s.budget_day_usd)),
    sprint: sprintId ? bar(sprintSpend(db, sprintId), limitOf(s.budget_sprint_usd)) : null,
  };
}

/** Why no more work may start now, or null. The message is shown to the user as is. */
export function overBudget(db: DB, sprintId?: number | null): string | null {
  const b = budgetStatus(db, sprintId);
  if (b.day.over) return `Budget reached: today's spend $${b.day.spent.toFixed(2)} is at the daily limit of $${b.day.limit}. Raise the limit in Settings to carry on.`;
  if (b.sprint?.over) return `Budget reached: this sprint has used $${b.sprint.spent.toFixed(2)} of its $${b.sprint.limit} limit. Raise the limit in Settings to carry on.`;
  return null;
}

export function registerBudget(app: FastifyInstance, db: DB) {
  app.get("/api/budget", async () => {
    const sprint = db.prepare("SELECT id, number, name FROM sprints WHERE status IN ('active','done') ORDER BY id DESC LIMIT 1").get() as { id: number; number: number; name: string } | undefined;
    return { ...budgetStatus(db, sprint?.id), sprint_info: sprint ?? null };
  });
}
