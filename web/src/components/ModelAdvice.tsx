import { useEffect, useState } from "react";
import { post } from "../api.ts";

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
    <span className={`dots ${seen ? "" : "exp"}`} title={`${RATING_WORD[rating]} · ${seen ? "seen in real runs" : "expected, not measured here"}`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= rating ? "on" : ""} />)}
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
  const [work, setWork] = useState<Work | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const specialty = /^\s*Specialty:.*$/im.exec(context)?.[0] ?? "";
  useEffect(() => { setWork(null); }, [role]);
  useEffect(() => {
    setAnswer(null);
    if (!models.length) return;
    let live = true;
    post<Answer>("/api/model-advice", { kind, models, role, work: work ?? undefined, context: specialty }).then((a) => live && setAnswer(a)).catch(() => {});
    return () => { live = false; };
  }, [kind, models, role, work, specialty]);

  if (!models.length || !answer) return null;
  return (
    <div className="advice" style={{ gridColumn: "1 / -1" }}>
      <div className="advice-head">
        <b>Recommended for a {ROLE_NAME[role]}</b>
        {role === "worker" && (
          <span className="chips">
            {DEV_WORK.map((w) => (
              <button type="button" key={w} className={`chip ${answer.work === w ? "on" : ""}`} onClick={() => setWork(w)}>{WORK_LABEL[w]}</button>
            ))}
          </span>
        )}
        <span className="spacer" />
        <a href="#/guides?tab=models" className="hint">Model guide</a>
      </div>
      {answer.limited && answer.rows.length > 0 && <div className="hint">Nothing from this provider is rated good for this job. The least bad are shown.</div>}
      {!answer.rows.length && <div className="hint">No model from this provider suits this job (for planning and review, small local models are too weak). Pick another provider, or a larger model.</div>}
      {answer.rows.map((a) => (
        <button type="button" key={a.model} className={`advice-row ${a.model === value ? "on" : ""}`} onClick={() => onPick(a.model)} title={a.note}>
          <span className="advice-main">
            <span className="mono">{a.model}</span>
            {a.start && <span className="badge good">start here</span>}
            {a.model === value && <span className="badge">selected</span>}
          </span>
          <Dots rating={a.rating} seen={a.seen} />
          <span className="hint advice-price">{priceText(a)}</span>
        </button>
      ))}
    </div>
  );
}
