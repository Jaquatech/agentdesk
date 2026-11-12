import { useEffect, useState } from "react";
import { get, useLiveEvents } from "../api.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Bar = { spent: number; limit: number; over: boolean; warn: boolean };
type Budget = { day: Bar; sprint: Bar | null; sprint_info: { number: number; name: string } | null };

/** Shown only when a spending limit is near (80%) or reached. */
export function BudgetBar() {
  const [b, setB] = useState<Budget | null>(null);
  const load = () => { get<Budget>("/api/budget").then(setB).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
  useLiveEvents((ev) => { if (ev.type === "task") load(); });
  if (!b) return null;
  const lines: { text: string; over: boolean }[] = [];
  if (b.day.warn) lines.push({ over: b.day.over, text: `Today: $${b.day.spent.toFixed(2)} of the $${b.day.limit} daily limit${b.day.over ? ". Work is paused." : "."}` });
  if (b.sprint?.warn) lines.push({ over: b.sprint.over, text: `Sprint ${b.sprint_info?.number}: $${b.sprint.spent.toFixed(2)} of the $${b.sprint.limit} sprint limit${b.sprint.over ? ". Work is paused." : "."}` });
  if (!lines.length) return null;
  const over = lines.some((l) => l.over);
  return (
    <Alert variant={over ? "destructive" : "default"} className={cn("shrink-0 rounded-none border-x-0", !over && "border-warning/40 bg-warning/10")}>
      <AlertTitle>{over ? "Budget reached" : "Budget"}</AlertTitle>
      <AlertDescription>
        {lines.map((l) => l.text).join(" ")}{" "}
        <a href="#/settings">Settings</a>
      </AlertDescription>
    </Alert>
  );
}
