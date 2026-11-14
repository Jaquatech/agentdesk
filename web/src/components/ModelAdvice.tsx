import { useEffect, useState } from "react";
import { post } from "../api.ts";
import { ToneBadge } from "./ui.tsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Work = "planning" | "backend" | "ui" | "small" | "docs" | "review";
export type Price = { price_in: number; price_out: number } | null;
type Advice = {
  model: string; label: string; rating: number; seen: boolean; start: boolean; free: boolean; cloud: boolean; price: Price; note: string;
};
type Answer = { work: Work; limited: boolean; rows: Advice[] };

export const WORK_LABEL: Record<Work, string> = {
  planning: "Planning", backend: "Code & logic", ui: "UI & front end", small: "Small edits", docs: "Documents & copy", review: "Review",
};
const DEV_WORK: Work[] = ["backend", "ui", "small", "docs"];
const ROLE_NAME = { planner: "planner", worker: "developer", reviewer: "reviewer" } as const;
const RATING_WORD = ["avoid", "limited", "good", "best"];

/** Three pips for how well a model suits a job. Solid = seen in real runs here; faded = expected, not measured. */
export function Dots({ rating, seen }: { rating: number; seen: boolean }) {
  return (
    <span className="inline-flex gap-0.5" title={`${RATING_WORD[rating]} · ${seen ? "seen in real runs" : "expected, not measured here"}`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={cn("inline-block size-2 rounded-full border border-muted-foreground", i <= rating && (seen ? "border-primary bg-primary" : "border-primary bg-primary/40"))} />
      ))}
    </span>
  );
}

export function priceText(a: { free: boolean; cloud: boolean; price: Price }) {
  if (a.free) return "free · runs on your machine";
  if (a.price) return `$${a.price.price_in} in / $${a.price.price_out} out per M tokens`;
  return a.cloud ? "Ollama cloud plan" : "price not set (Usage)";
}

/**
 * "Recommended for this job": the models the chosen provider offers, best fit first. Picking one fills the Model field.
 * A developer's job is read from the "Specialty:" line of its instructions, and can be changed here.
 */
export function ModelAdvice({ kind, models, role, context, value, onPick }: {
  kind: string; models: string[]; role: "planner" | "worker" | "reviewer"; context: string; value: string; onPick: (model: string) => void;
}) {
  const [picked, setPicked] = useState<{ role: string; work: Work } | null>(null);
  const [answered, setAnswered] = useState<{ key: string; answer: Answer } | null>(null);
  const specialty = /^\s*Specialty:.*$/im.exec(context)?.[0] ?? "";
  const work = picked && picked.role === role ? picked.work : null;
  const key = JSON.stringify([kind, models, role, work, specialty]);
  const answer = answered && answered.key === key ? answered.answer : null;
  useEffect(() => {
    if (!models.length) return;
    let live = true;
    post<Answer>("/api/model-advice", { kind, models, role, work: work ?? undefined, context: specialty }).then((a) => live && setAnswered({ key: JSON.stringify([kind, models, role, work, specialty]), answer: a })).catch(() => {});
    return () => { live = false; };
  }, [kind, models, role, work, specialty]);

  if (!models.length || !answer) return null;
  return (
    <div className="col-span-full flex flex-col gap-2 rounded-lg border bg-muted p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>Recommended for a {ROLE_NAME[role]}</b>
        {role === "worker" && (
          <span className="flex flex-wrap gap-1">
            {DEV_WORK.map((w) => (
              <Button type="button" key={w} size="sm" variant={answer.work === w ? "default" : "outline"} onClick={() => setPicked({ role, work: w })}>{WORK_LABEL[w]}</Button>
            ))}
          </span>
        )}
        <a href="#/documents?tab=models" className="ml-auto text-xs text-muted-foreground">Model guide</a>
      </div>
      {answer.limited && answer.rows.length > 0 && <p className="text-xs text-muted-foreground">Nothing from this provider is rated good for this job. The least bad are shown.</p>}
      {!answer.rows.length && <p className="text-xs text-muted-foreground">No model from this provider suits this job (for planning and review, small local models are too weak). Pick another provider, or a larger model.</p>}
      {answer.rows.map((a) => (
        <button type="button" key={a.model} title={a.note} onClick={() => onPick(a.model)}
          className={cn("grid w-full grid-cols-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left text-sm hover:border-primary sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1.2fr)]", a.model === value && "border-primary bg-accent")}>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono">{a.model}</span>
            {a.start && <ToneBadge tone="good">start here</ToneBadge>}
            {a.model === value && <ToneBadge>selected</ToneBadge>}
          </span>
          <Dots rating={a.rating} seen={a.seen} />
          <span className="text-xs text-muted-foreground sm:text-right">{priceText(a)}</span>
        </button>
      ))}
    </div>
  );
}
