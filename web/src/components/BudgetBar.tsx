import { useEffect, useState } from "react";
import { get, useLiveEvents } from "../api.ts";

type Bar = { spent: number; limit: number; over: boolean; warn: boolean };
type Budget = { day: Bar; sprint: Bar | null; sprint_info: { number: number; name: string } | null };

/** Shown only when a spending limit is near (80%) or reached. */
export function BudgetBar() {
  const [b, setB] = useState<Budget | null>(null);
  const load = () => { get<Budget>("/api/budget").then(setB).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
  // A finished call changes the totals: refresh when a task or message arrives.
  useLiveEvents((ev) => { if (ev.type === "task") load(); });
  if (!b) return null;
  const lines: { text: string; over: boolean }[] = [];
  if (b.day.warn) lines.push({ over: b.day.over, text: `Today: $${b.day.spent.toFixed(2)} of the $${b.day.limit} daily limit${b.day.over ? ". Work is paused." : "."}` });
  if (b.sprint?.warn) lines.push({ over: b.sprint.over, text: `Sprint ${b.sprint_info?.number}: $${b.sprint.spent.toFixed(2)} of the $${b.sprint.limit} sprint limit${b.sprint.over ? ". Work is paused." : "."}` });
  if (!lines.length) return null;
  const over = lines.some((l) => l.over);
  return (
    <div className="demo-banner" style={over ? { background: "var(--bad)", color: "#fff" } : undefined}>
      <b>{over ? "Budget reached" : "Budget"}</b> {lines.map((l) => l.text).join(" ")} <a href="#/settings" style={{ color: "inherit", textDecoration: "underline" }}>Settings</a>
    </div>
  );
}
