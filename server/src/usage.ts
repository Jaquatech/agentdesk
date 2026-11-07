import type { FastifyInstance } from "fastify";
import type { DB } from "./db.ts";
import { callCost, findPrice, type ModelPrice } from "./pricing.ts";

/** Usage and billing: what every agent call cost, by day, agent, model and project. Days are local dates. */

const DAY = "date(r.started_at, 'localtime')";
const TOKENS = `COALESCE(SUM(r.tokens_in),0) AS tokens_in, COALESCE(SUM(r.cache_read),0) AS cache_read,
  COALESCE(SUM(r.cache_write),0) AS cache_write, COALESCE(SUM(r.tokens_out),0) AS tokens_out`;
const COST = `ROUND(COALESCE(SUM(r.cost_usd),0), 6) AS cost_usd, COUNT(r.id) AS runs,
  SUM(CASE WHEN r.cost_usd IS NULL AND r.status != 'running' THEN 1 ELSE 0 END) AS unpriced`;

function period(days: unknown) {
  const n = Math.max(0, Math.min(3650, Number(days) || 0));
  return n ? { where: "r.engine != 'shell' AND r.started_at >= datetime('now', ?)", args: [`-${n} days`] } : { where: "r.engine != 'shell'", args: [] as string[] };
}

const PROJECT = "COALESCE(r.project_id, (SELECT c.project_id FROM chats c WHERE c.id = r.chat_id))";

export function registerUsage(app: FastifyInstance, db: DB) {
  app.get("/api/usage", async (req) => {
    const p = period((req.query as Record<string, string>).days ?? 30);
    const q = (sql: string) => db.prepare(sql).all(...p.args);
    return {
      totals: db.prepare(`SELECT ${COST}, ${TOKENS} FROM runs r WHERE ${p.where}`).get(...p.args),
      daily: q(`SELECT ${DAY} AS day, ${COST}, ${TOKENS} FROM runs r WHERE ${p.where} GROUP BY day ORDER BY day`),
      byAgent: q(`SELECT a.name, a.role, ${COST}, ${TOKENS} FROM runs r JOIN agents a ON a.id = r.agent_id
        WHERE ${p.where} GROUP BY a.id ORDER BY cost_usd DESC, runs DESC`),
      byModel: q(`SELECT CASE WHEN r.model = '' THEN '(unknown)' ELSE r.model END AS model, r.engine, ${COST}, ${TOKENS}
        FROM runs r WHERE ${p.where} GROUP BY r.model, r.engine ORDER BY cost_usd DESC, runs DESC`),
      byProject: q(`SELECT COALESCE(p.name, '(no project)') AS name, ${COST}, ${TOKENS} FROM runs r
        LEFT JOIN projects p ON p.id = ${PROJECT} WHERE ${p.where} GROUP BY p.id ORDER BY cost_usd DESC, runs DESC`),
      byKind: q(`SELECT r.kind, ${COST}, ${TOKENS} FROM runs r WHERE ${p.where} GROUP BY r.kind ORDER BY cost_usd DESC`),
    };
  });

  // Every call of one day (the daily log).
  app.get("/api/usage/runs", async (req) => {
    const { day } = req.query as Record<string, string>;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return [];
    return db.prepare(`SELECT r.id, r.started_at, r.kind, r.round, r.model, r.engine, r.status, r.turns, r.seconds,
        r.tokens_in, r.cache_read, r.cache_write, r.tokens_out, r.cost_usd,
        a.name AS agent, a.role, t.title AS task, c.title AS chat, p.name AS project
      FROM runs r LEFT JOIN agents a ON a.id = r.agent_id LEFT JOIN tasks t ON t.id = r.task_id
      LEFT JOIN chats c ON c.id = r.chat_id LEFT JOIN projects p ON p.id = ${PROJECT}
      WHERE ${DAY} = ? AND r.engine != 'shell' ORDER BY r.started_at, r.id`).all(day);
  });

  app.get("/api/usage/export.csv", async (req, reply) => {
    const p = period((req.query as Record<string, string>).days ?? 0);
    const rows = db.prepare(`SELECT r.started_at, a.name AS agent, a.role, r.kind, r.model, r.engine, p.name AS project,
        t.title AS task, r.status, r.turns, r.seconds, r.tokens_in, r.cache_read, r.cache_write, r.tokens_out, r.cost_usd
      FROM runs r LEFT JOIN agents a ON a.id = r.agent_id LEFT JOIN tasks t ON t.id = r.task_id
      LEFT JOIN projects p ON p.id = ${PROJECT} WHERE ${p.where} ORDER BY r.id`).all(...p.args) as Record<string, unknown>[];
    const cols = ["started_at", "agent", "role", "kind", "model", "engine", "project", "task", "status", "turns", "seconds",
      "tokens_in", "cache_read", "cache_write", "tokens_out", "cost_usd"];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="agent-usage-${new Date().toISOString().slice(0, 10)}.csv"`);
    return "﻿" + csv; // BOM so Excel reads UTF-8
  });

  // ---------- model prices ----------
  app.get("/api/model-prices", async () => db.prepare("SELECT * FROM model_prices ORDER BY model").all());

  const fields = (b: Record<string, unknown>): ModelPrice => ({
    model: String(b.model ?? "").trim(),
    price_in: Math.max(0, Number(b.price_in) || 0), price_out: Math.max(0, Number(b.price_out) || 0),
    cache_read: Math.max(0, Number(b.cache_read) || 0), cache_write: Math.max(0, Number(b.cache_write) || 0),
    long_threshold: Math.max(0, Math.round(Number(b.long_threshold) || 0)),
    long_multiplier: Math.max(1, Number(b.long_multiplier) || 1),
    note: String(b.note ?? "").slice(0, 300),
  });
  app.put("/api/model-prices", async (req, reply) => {
    const f = fields(req.body as Record<string, unknown>);
    if (!f.model) return reply.code(400).send({ error: "Model id is required" });
    const original = String((req.body as Record<string, unknown>).original ?? "");
    db.transaction(() => {
      if (original && original !== f.model) db.prepare("DELETE FROM model_prices WHERE model = ?").run(original);
      db.prepare(`INSERT INTO model_prices (model, price_in, price_out, cache_read, cache_write, long_threshold, long_multiplier, note, updated_at)
        VALUES (@model, @price_in, @price_out, @cache_read, @cache_write, @long_threshold, @long_multiplier, @note, datetime('now'))
        ON CONFLICT(model) DO UPDATE SET price_in = excluded.price_in, price_out = excluded.price_out, cache_read = excluded.cache_read,
          cache_write = excluded.cache_write, long_threshold = excluded.long_threshold, long_multiplier = excluded.long_multiplier,
          note = excluded.note, updated_at = excluded.updated_at`).run(f);
    })();
    return { ok: true };
  });
  app.delete("/api/model-prices/:model", async (req) => {
    db.prepare("DELETE FROM model_prices WHERE model = ?").run(decodeURIComponent((req.params as Record<string, string>).model));
    return { ok: true };
  });

  /**
   * Re-prices past API-loop runs with the current price table (e.g. after fixing a price). The Claude CLI reports its
   * own cost, so its runs keep it. A run's tokens are totals, so the long-prompt tier is judged on the average call.
   */
  app.post("/api/usage/reprice", async () => {
    const runs = db.prepare(`SELECT id, model, engine, turns, tokens_in, cache_read, cache_write, tokens_out FROM runs
      WHERE engine IN ('anthropic','openai','ollama') AND status != 'running'`).all() as
      { id: number; model: string; engine: string; turns: number | null; tokens_in: number; cache_read: number; cache_write: number; tokens_out: number }[];
    const upd = db.prepare("UPDATE runs SET cost_usd = ? WHERE id = ?");
    let changed = 0;
    db.transaction(() => {
      for (const r of runs) {
        const price = findPrice(db, r.model);
        const n = Math.max(1, r.turns ?? 1);
        const per = { input: r.tokens_in / n, cacheRead: r.cache_read / n, cacheWrite: r.cache_write / n, output: r.tokens_out / n };
        const cost = price ? Math.round(callCost(price, per) * n * 1e6) / 1e6 : r.engine === "ollama" ? 0 : null;
        upd.run(cost, r.id);
        changed++;
      }
      // Task totals follow their runs.
      db.prepare(`UPDATE tasks SET cost_usd = COALESCE((SELECT SUM(cost_usd) FROM runs WHERE runs.task_id = tasks.id), 0)`).run();
    })();
    return { repriced: changed };
  });
}
