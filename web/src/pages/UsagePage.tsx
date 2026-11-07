import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import { get, put, post, del } from "../api.ts";
import { Field, Modal } from "../components/ui.tsx";
import { NoFillInput } from "../components/inputs.tsx";

type Tokens = { tokens_in: number; cache_read: number; cache_write: number; tokens_out: number };
type Agg = Tokens & { cost_usd: number; runs: number; unpriced: number };
type Usage = {
  totals: Agg;
  daily: (Agg & { day: string })[];
  byAgent: (Agg & { name: string; role: string })[];
  byModel: (Agg & { model: string; engine: string })[];
  byProject: (Agg & { name: string })[];
  byKind: (Agg & { kind: string })[];
};
type RunRow = Tokens & {
  id: number; started_at: string; kind: string; round: number; model: string; engine: string; status: string;
  turns: number | null; seconds: number | null; cost_usd: number | null; agent: string; role: string; task: string | null; chat: string | null; project: string | null;
};
type Price = { model: string; price_in: number; price_out: number; cache_read: number; cache_write: number; long_threshold: number; long_multiplier: number; note: string };

const PERIODS = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 0, label: "All" }];

export const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n));
export const fmtUsd = (v: number | null | undefined) => v === null || v === undefined ? "–" : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : v < 100 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`;
const totalTokens = (t: Tokens) => t.tokens_in + t.cache_read + t.cache_write + t.tokens_out;

export function UsagePage() {
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const load = () => get<Usage>(`/api/usage?days=${days}`).then(setUsage);
  useEffect(() => { load(); setOpenDay(null); }, [days]);

  const t = usage?.totals;
  const prompt = t ? t.tokens_in + t.cache_read + t.cache_write : 0;
  return (
    <>
      <div className="page-head">
        <h1>Usage &amp; billing</h1>
        <div className="tabs">
          {PERIODS.map((p) => <button key={p.days} className={`tab ${days === p.days ? "active" : ""}`} onClick={() => setDays(p.days)}>{p.label}</button>)}
        </div>
        <a className="btn small" href={`/api/usage/export.csv?days=${days}`}><Download size={13} /> CSV</a>
      </div>
      <div className="page"><div className="wide">
        {t && (
          <div className="tiles">
            <Tile label="Cost" value={fmtUsd(t.cost_usd)} sub={t.unpriced ? `${t.unpriced} call${t.unpriced === 1 ? "" : "s"} without a price` : "all calls priced"} warn={!!t.unpriced} />
            <Tile label="Agent calls" value={String(t.runs)} sub={usage!.byKind.map((k) => `${k.runs} ${k.kind}`).join(" · ") || "–"} />
            <Tile label="Input tokens" value={fmtTokens(prompt)} sub={prompt ? `${Math.round((t.cache_read / prompt) * 100)}% read from cache` : "–"} />
            <Tile label="Output tokens" value={fmtTokens(t.tokens_out)} sub={`${fmtTokens(t.cache_write)} written to cache`} />
          </div>
        )}
        {usage && <DailyChart daily={usage.daily} days={days} onPick={setOpenDay} picked={openDay} />}

        {usage && (
          <div className="grid3 breakdowns">
            <Breakdown title="By agent" rows={usage.byAgent.map((r) => ({ key: r.name, label: r.name, sub: r.role, ...r }))} total={t!.cost_usd} />
            <Breakdown title="By model" rows={usage.byModel.map((r) => ({ key: r.model + r.engine, label: r.model, sub: r.engine === "claude-cli" ? "Claude Code" : r.engine, ...r }))} total={t!.cost_usd} />
            <Breakdown title="By project" rows={usage.byProject.map((r) => ({ key: r.name, label: r.name, ...r }))} total={t!.cost_usd} />
          </div>
        )}

        <div className="section-title"><h2>Daily log</h2><span className="spacer" /><span className="hint">Click a day to see every call.</span></div>
        <div className="list">
          <div className="list-row table-head">
            <span className="c-day">Day</span><span className="c-num">Calls</span><span className="c-num">Input</span>
            <span className="c-num">Cache read</span><span className="c-num">Output</span><span className="c-num">Cost</span>
          </div>
          {usage && usage.daily.length === 0 && <div className="list-row hint">No agent calls in this period.</div>}
          {usage && [...usage.daily].reverse().map((d) => (
            <Fragment key={d.day}>
              <div className={`list-row clickable ${openDay === d.day ? "picked" : ""}`} onClick={() => setOpenDay(openDay === d.day ? null : d.day)}>
                <span className="c-day">{fmtDay(d.day)}</span>
                <span className="c-num">{d.runs}</span>
                <span className="c-num">{fmtTokens(d.tokens_in + d.cache_write)}</span>
                <span className="c-num">{fmtTokens(d.cache_read)}</span>
                <span className="c-num">{fmtTokens(d.tokens_out)}</span>
                <span className="c-num"><b>{fmtUsd(d.cost_usd)}</b>{d.unpriced ? <span className="badge wait" title="Calls without a model price">+?</span> : null}</span>
              </div>
              {openDay === d.day && <DayRuns day={d.day} />}
            </Fragment>
          ))}
        </div>

        <PriceTable onChanged={load} />
      </div></div>
    </>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value num">{value}</div>
      <div className={`tile-sub ${warn ? "warn" : ""}`}>{sub}</div>
    </div>
  );
}

/** One series (cost per day): accent bars, rounded tops, recessive grid, a tooltip per bar. */
function DailyChart({ daily, days, onPick, picked }: { daily: Usage["daily"]; days: number; onPick: (d: string) => void; picked: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => fillDays(daily, days), [daily, days]);
  const W = 960, H = 200, padL = 52, padR = 8, padT = 10, padB = 24;
  const max = niceMax(Math.max(0, ...series.map((d) => d.cost_usd)));
  const step = (W - padL - padR) / Math.max(1, series.length);
  const barW = Math.max(2, Math.min(28, step - 2));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const labelEvery = Math.ceil(series.length / 10);
  const h = hover !== null ? series[hover] : null;

  return (
    <div className="card chart-card">
      <div className="row"><b>Cost per day</b><span className="hint">USD · local dates</span></div>
      {series.every((d) => !d.runs) ? <div className="empty" style={{ padding: 32 }}>No calls in this period yet.</div> : (
        <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Cost per day">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} className="grid" />
                <text x={padL - 6} y={y(max * f)} className="axis" textAnchor="end" dominantBaseline="middle">{fmtUsd(max * f)}</text>
              </g>
            ))}
            {series.map((d, i) => {
              const x = padL + i * step + (step - barW) / 2;
              const top = y(d.cost_usd);
              const hgt = Math.max(d.runs ? 1.5 : 0, H - padB - top);
              const r = Math.min(4, barW / 2, hgt);
              return (
                <g key={d.day}>
                  {hgt > 0 && (
                    <path className={`bar ${picked === d.day ? "picked" : ""} ${hover === i ? "hover" : ""}`}
                      d={`M${x},${H - padB} V${H - padB - hgt + r} Q${x},${H - padB - hgt} ${x + r},${H - padB - hgt} H${x + barW - r} Q${x + barW},${H - padB - hgt} ${x + barW},${H - padB - hgt + r} V${H - padB} Z`} />
                  )}
                  {/* hit target: the whole column, bigger than the bar */}
                  <rect x={padL + i * step} y={padT} width={step} height={H - padT - padB} fill="transparent"
                    onMouseEnter={() => setHover(i)} onClick={() => d.runs && onPick(d.day)} style={{ cursor: d.runs ? "pointer" : "default" }} />
                  {i % labelEvery === 0 && <text x={padL + i * step + step / 2} y={H - 6} className="axis" textAnchor="middle">{shortDay(d.day)}</text>}
                </g>
              );
            })}
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} className="baseline" />
          </svg>
          {h && (
            <div className="chart-tip" style={{ left: `${((padL + hover! * step + step / 2) / W) * 100}%` }}>
              <b>{fmtDay(h.day)}</b>
              <div className="num">{fmtUsd(h.cost_usd)} · {h.runs} call{h.runs === 1 ? "" : "s"}</div>
              <div className="hint num">{fmtTokens(h.tokens_in + h.cache_write)} in · {fmtTokens(h.cache_read)} cached · {fmtTokens(h.tokens_out)} out</div>
              {h.unpriced > 0 && <div className="hint">{h.unpriced} without a price</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; total: number; rows: (Agg & { key: string; label: string; sub?: string })[] }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {rows.length === 0 && <div className="hint" style={{ padding: "8px 14px 14px" }}>Nothing yet.</div>}
      {rows.map((r) => (
        <div key={r.key} className="bd-row">
          <div className="bd-name"><span className="ellipsis">{r.label}</span>{r.sub && <span className="hint"> {r.sub}</span>}</div>
          <div className="bd-meta num">{r.runs} · {fmtTokens(totalTokens(r))}</div>
          <div className="bd-cost num">{fmtUsd(r.cost_usd)}{r.unpriced ? <span className="badge wait" title="Calls without a model price">+?</span> : null}</div>
          <div className="bd-bar"><div style={{ width: `${total > 0 ? Math.max(1, (r.cost_usd / total) * 100) : 0}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function DayRuns({ day }: { day: string }) {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  useEffect(() => { get<RunRow[]>(`/api/usage/runs?day=${day}`).then(setRows); }, [day]);
  if (!rows) return <div className="list-row hint">Loading…</div>;
  return (
    <div className="day-runs">
      {rows.map((r) => (
        <div key={r.id} className="run-row">
          <span className="mono hint">{timeOf(r.started_at)}</span>
          <span><b>{r.agent ?? "–"}</b> <span className="badge">{r.kind}{r.round ? ` ${r.round + 1}` : ""}</span></span>
          <span className="ellipsis">{r.task ?? r.chat ?? r.project ?? ""}</span>
          <span className="mono hint ellipsis">{r.model}</span>
          <span className="num hint">{fmtTokens(r.tokens_in + r.cache_write)} / {fmtTokens(r.cache_read)} / {fmtTokens(r.tokens_out)}</span>
          <span className="num">{fmtUsd(r.cost_usd)}</span>
        </div>
      ))}
    </div>
  );
}

function PriceTable({ onChanged }: { onChanged: () => void }) {
  const [prices, setPrices] = useState<Price[]>([]);
  const [editing, setEditing] = useState<(Price & { original?: string }) | null>(null);
  const [msg, setMsg] = useState("");
  const load = () => get<Price[]>("/api/model-prices").then(setPrices);
  useEffect(() => { load(); }, []);
  const reprice = async () => {
    if (!confirm("Recalculate the cost of past calls with the current prices? Claude Code CLI calls keep the cost the CLI reported.")) return;
    const r = await post<{ repriced: number }>("/api/usage/reprice");
    setMsg(`${r.repriced} calls repriced.`);
    onChanged();
  };
  return (
    <>
      <div className="section-title">
        <div><h2>Model prices</h2><div className="hint">USD per million tokens. Each call is priced with the model the agent used, so agents on the same key are billed at their own model's rate. Claude Code CLI calls use the cost the CLI reports.</div></div>
        <span className="spacer" />
        <button className="btn small" onClick={reprice}><RefreshCw size={13} /> Apply to past calls</button>
        <button className="btn small" onClick={() => setEditing({ model: "", price_in: 0, price_out: 0, cache_read: 0, cache_write: 0, long_threshold: 0, long_multiplier: 1, note: "" })}><Plus size={13} /> Add model</button>
      </div>
      {msg && <div className="hint" style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="list">
        <div className="list-row table-head">
          <span className="c-model">Model</span><span className="c-num">Input</span><span className="c-num">Output</span>
          <span className="c-num">Cache read</span><span className="c-num">Cache write</span><span className="c-tier">Long prompts</span>
        </div>
        {prices.map((p) => (
          <div key={p.model} className="list-row clickable" title={p.note} onClick={() => setEditing({ ...p, original: p.model })}>
            <span className="c-model mono">{p.model}</span>
            <span className="c-num num">{p.price_in}</span><span className="c-num num">{p.price_out}</span>
            <span className="c-num num">{p.cache_read}</span><span className="c-num num">{p.cache_write}</span>
            <span className="c-tier hint">{p.long_threshold ? `over ${fmtTokens(p.long_threshold)}: ×${p.long_multiplier}` : "–"}</span>
          </div>
        ))}
        {prices.length === 0 && <div className="list-row hint">No prices. Calls show their tokens but no cost.</div>}
      </div>
      {editing && <PriceForm p={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function PriceForm({ p, onClose, onSaved }: { p: Price & { original?: string }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(p);
  const [error, setError] = useState("");
  const set = (k: keyof Price, v: string) => setF({ ...f, [k]: k === "model" || k === "note" ? v : Number(v) });
  const num = (k: keyof Price, label: string) => (
    <Field label={label}><input type="number" min={0} step="0.001" value={String(f[k])} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const save = async () => { try { await put("/api/model-prices", f); onSaved(); } catch (e) { setError((e as Error).message); } };
  const remove = async () => { if (confirm(`Remove the price of ${p.original}?`)) { await del(`/api/model-prices/${encodeURIComponent(p.original!)}`); onSaved(); } };
  return (
    <Modal title={p.original ? `Price of ${p.original}` : "Add a model price"} onClose={onClose}
      footer={<>{p.original && <button className="btn danger" onClick={remove}>Remove</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <Field label="Model id" hint="Exactly as the provider names it. A dated snapshot (…-20251001) uses the undated price.">
        <NoFillInput className="mono" value={f.model} onChange={(e) => set("model", e.target.value)} placeholder="claude-sonnet-5-5" />
      </Field>
      <div className="grid2">{num("price_in", "Input $ / M")}{num("price_out", "Output $ / M")}{num("cache_read", "Cache read $ / M")}{num("cache_write", "Cache write $ / M")}</div>
      <div className="grid2">
        {num("long_threshold", "Long-prompt threshold (tokens, 0 = none)")}
        {num("long_multiplier", "Multiplier above it")}
      </div>
      <Field label="Note"><NoFillInput value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Where the price comes from" /></Field>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

// ---------- dates ----------

function fillDays(daily: Usage["daily"], days: number) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const today = new Date();
  const first = days ? addDays(today, -(days - 1)) : daily.length ? new Date(daily[0].day + "T12:00:00") : today;
  const out: Usage["daily"] = [];
  for (let d = new Date(first); ymd(d) <= ymd(today); d = addDays(d, 1)) {
    out.push(byDay.get(ymd(d)) ?? { day: ymd(d), runs: 0, cost_usd: 0, unpriced: 0, tokens_in: 0, cache_read: 0, cache_write: 0, tokens_out: 0 });
  }
  return out;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (day: string) => new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const shortDay = (day: string) => new Date(day + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "numeric" });
const timeOf = (iso: string) => new Date(iso.replace(" ", "T") + "Z").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
function niceMax(v: number) {
  if (v <= 0) return 0.01;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}
