import { useCallback, Fragment, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import { get, put, post, del } from "../api.ts";
import { Field, FooterGap, Modal, ToneBadge } from "../components/ui.tsx";
import { NoFillInput } from "../components/inputs.tsx";
import { Page, Section } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
  const load = useCallback(() => get<Usage>(`/api/usage?days=${days}`).then(setUsage), [days]);
  useEffect(() => { load(); }, [load]);

  const t = usage?.totals;
  const prompt = t ? t.tokens_in + t.cache_read + t.cache_write : 0;
  return (
    <Page title="Usage & billing" width="wide" actions={
      <>
        <Tabs value={String(days)} onValueChange={(v) => { setDays(Number(v)); setOpenDay(null); }}>
          <TabsList>
            {PERIODS.map((p) => <TabsTrigger key={p.days} value={String(p.days)}>{p.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" asChild><a href={`/api/usage/export.csv?days=${days}`}><Download data-icon="inline-start" /> CSV</a></Button>
      </>
    }>
      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Cost" value={fmtUsd(t.cost_usd)} sub={t.unpriced ? `${t.unpriced} call${t.unpriced === 1 ? "" : "s"} without a price` : "all calls priced"} warn={!!t.unpriced} />
          <Tile label="Agent calls" value={String(t.runs)} sub={usage!.byKind.map((k) => `${k.runs} ${k.kind}`).join(" · ") || "–"} />
          <Tile label="Input tokens" value={fmtTokens(prompt)} sub={prompt ? `${Math.round((t.cache_read / prompt) * 100)}% read from cache` : "–"} />
          <Tile label="Output tokens" value={fmtTokens(t.tokens_out)} sub={`${fmtTokens(t.cache_write)} written to cache`} />
        </div>
      )}
      {usage && <DailyChart daily={usage.daily} days={days} onPick={setOpenDay} picked={openDay} />}

      {usage && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Breakdown title="By agent" rows={usage.byAgent.map((r) => ({ key: r.name, label: r.name, sub: r.role, ...r }))} total={t!.cost_usd} />
          <Breakdown title="By model" rows={usage.byModel.map((r) => ({ key: r.model + r.engine, label: r.model, sub: r.engine === "claude-cli" ? "Claude Code" : r.engine, ...r }))} total={t!.cost_usd} />
          <Breakdown title="By project" rows={usage.byProject.map((r) => ({ key: r.name, label: r.name, ...r }))} total={t!.cost_usd} />
        </div>
      )}

      <Section title="Daily log" hint="Click a day to see every call.">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cache read</TableHead><TableHead className="text-right">Output</TableHead><TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage && usage.daily.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No agent calls in this period.</TableCell></TableRow>}
              {usage && [...usage.daily].reverse().map((d) => (
                <Fragment key={d.day}>
                  <TableRow className={cn("cursor-pointer", openDay === d.day && "bg-accent")} onClick={() => setOpenDay(openDay === d.day ? null : d.day)}>
                    <TableCell>{fmtDay(d.day)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTokens(d.tokens_in + d.cache_write)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTokens(d.cache_read)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTokens(d.tokens_out)}</TableCell>
                    <TableCell className="text-right tabular-nums"><b>{fmtUsd(d.cost_usd)}</b>{d.unpriced ? <ToneBadge tone="wait" title="Calls without a model price">+?</ToneBadge> : null}</TableCell>
                  </TableRow>
                  {openDay === d.day && (
                    <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="bg-muted p-0"><DayRuns day={d.day} /></TableCell></TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>
      <PriceTable onChanged={load} />
    </Page>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className={cn("truncate text-xs text-muted-foreground", warn && "text-warning")}>{sub}</div>
      </CardContent>
    </Card>
  );
}

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
    <Card>
      <CardHeader>
        <CardTitle>Cost per day</CardTitle>
        <p className="text-xs text-muted-foreground">USD · local dates</p>
      </CardHeader>
      <CardContent>
        {series.every((d) => !d.runs) ? <p className="py-8 text-center text-sm text-muted-foreground">No calls in this period yet.</p> : (
          <div className="relative" role="group" aria-label="Cost per day: select a day to see its calls" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="group" aria-label="Cost per day">
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} className="stroke-border" />
                  <text x={padL - 6} y={y(max * f)} className="fill-muted-foreground text-[11px]" textAnchor="end" dominantBaseline="middle">{fmtUsd(max * f)}</text>
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
                      <path className={cn("fill-primary", picked === d.day && "fill-warm", hover === i && "brightness-110")}
                        d={`M${x},${H - padB} V${H - padB - hgt + r} Q${x},${H - padB - hgt} ${x + r},${H - padB - hgt} H${x + barW - r} Q${x + barW},${H - padB - hgt} ${x + barW},${H - padB - hgt + r} V${H - padB} Z`} />
                    )}
                    <rect x={padL + i * step} y={padT} width={step} height={H - padT - padB} fill="transparent"
                      onMouseEnter={() => setHover(i)} onClick={() => d.runs && onPick(d.day)} style={{ cursor: d.runs ? "pointer" : "default" }}
                      {...(d.runs ? { tabIndex: 0, role: "button", "aria-label": `${fmtDay(d.day)}, ${fmtUsd(d.cost_usd)}, ${d.runs} call${d.runs === 1 ? "" : "s"}`, onFocus: () => setHover(i), onBlur: () => setHover(null), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(d.day); } } } : {})} />
                    {i % labelEvery === 0 && <text x={padL + i * step + step / 2} y={H - 6} className="fill-muted-foreground text-[11px]" textAnchor="middle">{shortDay(d.day)}</text>}
                  </g>
                );
              })}
              <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} className="stroke-muted-foreground/60" />
            </svg>
            {h && (
              <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md" style={{ left: `${((padL + hover! * step + step / 2) / W) * 100}%` }}>
                <b>{fmtDay(h.day)}</b>
                <div className="tabular-nums">{fmtUsd(h.cost_usd)} · {h.runs} call{h.runs === 1 ? "" : "s"}</div>
                <div className="text-muted-foreground tabular-nums">{fmtTokens(h.tokens_in + h.cache_write)} in · {fmtTokens(h.cache_read)} cached · {fmtTokens(h.tokens_out)} out</div>
                {h.unpriced > 0 && <div className="text-muted-foreground">{h.unpriced} without a price</div>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Breakdown({ title, rows, total }: { title: string; total: number; rows: (Agg & { key: string; label: string; sub?: string })[] }) {
  return (
    <Card className="gap-0 py-0">
      <div className="px-4 pt-3 pb-1 text-sm font-medium">{title}</div>
      {rows.length === 0 && <p className="px-4 pb-3 text-xs text-muted-foreground">Nothing yet.</p>}
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2 px-4 py-1.5 text-sm">
          <div className="flex min-w-0 gap-1"><span className="truncate">{r.label}</span>{r.sub && <span className="text-xs text-muted-foreground">{r.sub}</span>}</div>
          <div className="text-xs text-muted-foreground tabular-nums">{r.runs} · {fmtTokens(totalTokens(r))}</div>
          <div className="text-right font-medium tabular-nums">{fmtUsd(r.cost_usd)}{r.unpriced ? <ToneBadge tone="wait" title="Calls without a model price">+?</ToneBadge> : null}</div>
          <div className="col-span-full h-0.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${total > 0 ? Math.max(1, (r.cost_usd / total) * 100) : 0}%` }} /></div>
        </div>
      ))}
    </Card>
  );
}

function DayRuns({ day }: { day: string }) {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  useEffect(() => { get<RunRow[]>(`/api/usage/runs?day=${day}`).then(setRows); }, [day]);
  if (!rows) return <p className="px-4 py-2 text-xs text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col py-1">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-2 px-4 py-1 text-xs sm:grid-cols-[3.5rem_11rem_1fr_10rem_9rem_4.5rem]">
          <span className="font-mono text-muted-foreground">{timeOf(r.started_at)}</span>
          <span><b>{r.agent ?? "–"}</b> <ToneBadge>{r.kind}{r.round ? ` ${r.round + 1}` : ""}</ToneBadge></span>
          <span className="hidden truncate sm:inline">{r.task ?? r.chat ?? r.project ?? ""}</span>
          <span className="hidden truncate font-mono text-muted-foreground sm:inline">{r.model}</span>
          <span className="hidden text-muted-foreground tabular-nums sm:inline">{fmtTokens(r.tokens_in + r.cache_write)} / {fmtTokens(r.cache_read)} / {fmtTokens(r.tokens_out)}</span>
          <span className="text-right tabular-nums">{fmtUsd(r.cost_usd)}</span>
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
      <Section title="Model prices" hint="USD per million tokens. Each call is priced with the model the agent used, so agents on the same key are billed at their own model's rate. Claude Code CLI calls use the cost the CLI reports."
        action={<>
          <Button variant="outline" size="sm" onClick={reprice}><RefreshCw data-icon="inline-start" /> Apply to past calls</Button>
          <Button variant="outline" size="sm" onClick={() => setEditing({ model: "", price_in: 0, price_out: 0, cache_read: 0, cache_write: 0, long_threshold: 0, long_multiplier: 1, note: "" })}><Plus data-icon="inline-start" /> Add model</Button>
        </>}>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead><TableHead className="text-right">Input</TableHead><TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cache read</TableHead><TableHead className="text-right">Cache write</TableHead><TableHead className="text-right">Long prompts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.map((p) => (
                <TableRow key={p.model} title={p.note} className="cursor-pointer" onClick={() => setEditing({ ...p, original: p.model })}>
                  <TableCell className="font-mono">{p.model}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.price_in}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.price_out}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.cache_read}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.cache_write}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{p.long_threshold ? `over ${fmtTokens(p.long_threshold)}: ×${p.long_multiplier}` : "–"}</TableCell>
                </TableRow>
              ))}
              {prices.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No prices. Calls show their tokens but no cost.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      </Section>
      {editing && <PriceForm p={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function PriceForm({ p, onClose, onSaved }: { p: Price & { original?: string }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(p);
  const [error, setError] = useState("");
  const set = (k: keyof Price, v: string) => setF({ ...f, [k]: k === "model" || k === "note" ? v : Number(v) });
  const num = (k: keyof Price, label: string) => (
    <Field label={label}><Input type="number" min={0} step="0.001" value={String(f[k])} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const save = async () => { try { await put("/api/model-prices", f); onSaved(); } catch (e) { setError((e as Error).message); } };
  const remove = async () => { if (confirm(`Remove the price of ${p.original}?`)) { await del(`/api/model-prices/${encodeURIComponent(p.original!)}`); onSaved(); } };
  return (
    <Modal title={p.original ? `Price of ${p.original}` : "Add a model price"} onClose={onClose}
      footer={<>{p.original && <Button variant="destructive" onClick={remove}>Remove</Button>}<FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <Field label="Model id" hint="Exactly as the provider names it. A dated snapshot (…-20251001) uses the undated price.">
        <NoFillInput className="font-mono" value={f.model} onChange={(e) => set("model", e.target.value)} placeholder="claude-sonnet-5-5" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">{num("price_in", "Input $ / M")}{num("price_out", "Output $ / M")}{num("cache_read", "Cache read $ / M")}{num("cache_write", "Cache write $ / M")}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        {num("long_threshold", "Long-prompt threshold (tokens, 0 = none)")}
        {num("long_multiplier", "Multiplier above it")}
      </div>
      <Field label="Note"><NoFillInput value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Where the price comes from" /></Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}

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
