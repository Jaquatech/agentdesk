import type { FastifyInstance } from "fastify";
import type { DB } from "./db.ts";
import { findPrice, type ModelPrice } from "./pricing.ts";

/**
 * Which model suits which work. One table feeds the "recommended models" box in the agent form and the Model guide page.
 *
 * Every rating says where it comes from: "seen" = observed in real runs on this platform, "expected" = a size- or
 * family-based expectation that has not been measured here. Change the table when your own runs say otherwise.
 */
export type Work = "planning" | "backend" | "ui" | "small" | "docs" | "review";
export type Role = "planner" | "worker" | "reviewer";
/** 0 = avoid, 1 = limited, 2 = good, 3 = best */
export type Rating = 0 | 1 | 2 | 3;

export const WORK: { id: Work; label: string; hint: string }[] = [
  { id: "planning", label: "Planning", hint: "Splitting a request into tasks and choosing who does what (the planner)." },
  { id: "backend", label: "Code & logic", hint: "Backend, scripts, integrations, tests: changes where correctness matters more than looks." },
  { id: "ui", label: "UI & front end", hint: "HTML, CSS, layout, visual detail. Needs a feel for how the page ends up looking." },
  { id: "small", label: "Small edits", hint: "One or two files, exact instructions: a rename, a text change, adding a section." },
  { id: "docs", label: "Documents & copy", hint: "README, specs, proposals, job ads, release notes, page text." },
  { id: "review", label: "Review", hint: "Reading the change and the checks and deciding approve or fix (the reviewer)." },
];
export const ROLE_WORK: Record<Role, Work[]> = {
  planner: ["planning"],
  worker: ["backend", "ui", "small", "docs"],
  reviewer: ["review"],
};
const ORDER: Work[] = ["planning", "backend", "ui", "small", "docs", "review"];
const fit = (...r: Rating[]) => Object.fromEntries(ORDER.map((w, i) => [w, r[i]])) as Record<Work, Rating>;

type Rule = {
  id: string; group: string; label: string; example: string; tier: string;
  ratings: Record<Work, Rating>; seen: Work[]; start: Work[]; note: string;
  chat?: false; free?: boolean; cloud?: boolean;
  test: (model: string) => boolean;
};

const GUESS = "Guessed from the model's name; check the provider's own page for it.";
const sizeOf = (model: string) => {
  const m = /(?:^|[:\-_ ])(\d+(?:\.\d+)?)b(?![a-z])/i.exec(model);
  return m ? Number(m[1]) : null;
};
const isCloud = (model: string) => /(?:[:-]cloud)$/i.test(model);
const embedding = (model: string) => /embed|bge-|rerank/i.test(model);
const claude = (family: string) => (m: string) => new RegExp(`(^|[/-])${family}($|-)`, "i").test(m) || m.toLowerCase() === family;

/** First match wins. */
const RULES: Rule[] = [
  {
    id: "haiku", group: "Claude", label: "Claude Haiku", example: "claude-haiku-5-5", tier: "Fast and cheap",
    ratings: fit(1, 2, 1, 3, 2, 1), seen: ["backend", "ui"], start: ["backend", "small", "docs"],
    note: "Good for code, logic and small edits at a fraction of the cost. Weak on UI work (layout, CSS, visual detail): use Sonnet for that. Ratings are for the 5.5 generation; older ones are weaker.",
    test: claude("haiku"),
  },
  {
    id: "sonnet", group: "Claude", label: "Claude Sonnet", example: "claude-sonnet-5-5", tier: "Balanced",
    ratings: fit(3, 3, 2, 3, 3, 3), seen: ["planning", "review"], start: ["planning", "ui", "review"],
    note: "The best value as planner and reviewer, and the step up for UI work or for a task Haiku got wrong twice.",
    test: claude("sonnet"),
  },
  {
    id: "opus", group: "Claude", label: "Claude Opus", example: "claude-opus-5-5", tier: "Strongest",
    ratings: fit(3, 3, 3, 3, 3, 3), seen: [], start: [],
    note: "About twice Sonnet's price per token at list prices (see Usage). Keep it for the hardest planning or a task Sonnet could not finish; you do not need it to start.",
    test: claude("opus"),
  },
  {
    id: "embedding", group: "Local and open models", label: "Embedding model", example: "bge-m3", tier: "Not a chat model",
    ratings: fit(0, 0, 0, 0, 0, 0), seen: [], start: [], chat: false, note: "Turns text into numbers for search. It cannot work as an agent.",
    test: embedding,
  },
  {
    id: "tiny", group: "Local and open models", label: "Tiny (up to 4B)", example: "qwen3:4b", tier: "Free, runs on your machine", free: true,
    ratings: fit(0, 1, 1, 1, 1, 0), seen: [], start: [],
    note: "Too small to plan or review. In our runs qwen3:4b pasted code into its answer instead of calling the file tools and rewrote whole files. Fine for trying the app.",
    test: (m) => (sizeOf(m) ?? 99) <= 4 && !isCloud(m),
  },
  {
    id: "small-local", group: "Local and open models", label: "Small (5–9B)", example: "qwen3:8b", tier: "Free, runs on your machine", free: true,
    ratings: fit(1, 1, 1, 2, 2, 1), seen: [], start: [],
    note: "Handles small, exact edits. Give it one or two files per task and turn Thinking off.",
    test: (m) => { const s = sizeOf(m); return s !== null && s > 4 && s < 10 && !isCloud(m); },
  },
  {
    id: "medium-local", group: "Local and open models", label: "Medium (10–25B)", example: "gpt-oss:20b", tier: "Free, needs ~16 GB of video memory", free: true,
    ratings: fit(1, 2, 1, 2, 2, 2), seen: [], start: [],
    note: "Decent at calling tools. Needs small, exact tasks.",
    test: (m) => { const s = sizeOf(m); return s !== null && s >= 10 && s < 26 && !isCloud(m); },
  },
  {
    id: "large-local", group: "Local and open models", label: "Large (26–99B)", example: "qwen3-coder:30b", tier: "Free, needs a strong machine", free: true,
    ratings: fit(2, 2, 2, 3, 2, 2), seen: [], start: [],
    note: "The best local coders sit here. Coder variants are the better pick for code.",
    test: (m) => { const s = sizeOf(m); return s !== null && s >= 26 && s < 100 && !isCloud(m); },
  },
  {
    id: "xlarge", group: "Local and open models", label: "Very large (100B+) and Ollama cloud models", example: "gpt-oss:120b-cloud", tier: "Ollama cloud plan or a very strong machine", cloud: true,
    ratings: fit(2, 3, 2, 3, 3, 2), seen: [], start: [],
    note: "Closest to Haiku-level work without a per-token bill. Tags ending in -cloud run on Ollama's servers after `ollama signin`, within your plan's usage limits.",
    test: (m) => isCloud(m) || (sizeOf(m) ?? 0) >= 100,
  },
  {
    id: "generic-small", group: "Other providers", label: "Small or fast model (by name)", example: "…-mini, …-flash", tier: "Guess from the name",
    ratings: fit(1, 2, 1, 3, 2, 1), seen: [], start: [], note: GUESS, test: (m) => /mini|nano|small|flash|lite/i.test(m),
  },
  {
    id: "generic-top", group: "Other providers", label: "Top model (by name)", example: "…-pro, …-large", tier: "Guess from the name",
    ratings: fit(3, 3, 3, 3, 3, 3), seen: [], start: [], note: GUESS, test: (m) => /(^|[-_/:])(pro|large|max|ultra)($|[-_.:])/i.test(m),
  },
  {
    id: "generic-mid", group: "Other providers", label: "Any other model", example: "", tier: "Guess from the name",
    ratings: fit(2, 2, 2, 3, 2, 2), seen: [], start: [], note: GUESS, test: () => true,
  },
];

/** Ollama tags with no size and no -cloud ("llama3:latest") are not guessed at: the size is what decides. */
export function classify(model: string, kind?: string): Rule | undefined {
  const r = model ? RULES.find((x) => x.test(model)) : undefined;
  return r && kind === "ollama" && r.group === "Other providers" ? undefined : r;
}

/** The kind of work a developer does, read from the "Specialty:" line the gallery agents start with. */
export function guessWork(context: string): Work {
  const line = /^\s*Specialty:\s*(.*)$/im.exec(context ?? "")?.[1] ?? "";
  if (/documentation|copy|release notes|proposal|meeting|one-pager|battlecard|brief|social|job description|interview|onboarding|user stories|writing|specs/i.test(line)) return "docs";
  if (/frontend|front-end|\bui\b|css|html|react|design|accessib|landing/i.test(line)) return "ui";
  return "backend";
}

export type Advice = {
  model: string; rule: string; label: string; rating: Rating; seen: boolean; start: boolean;
  free: boolean; cloud: boolean; price: ModelPrice | null; note: string;
};

/**
 * The provider's models that suit this job, best first: the starter pick, then by rating, then cheapest.
 * Only "good" and "best" are listed; when a provider has nothing that good, the least bad ones are, marked limited.
 */
export function advise(db: DB, o: { kind?: string; models: string[]; role: Role; work?: Work; limit?: number }) {
  const work: Work = o.role === "planner" ? "planning" : o.role === "reviewer" ? "review" : o.work ?? "backend";
  const all = new Set(o.models);
  const rows: Advice[] = [];
  for (const model of all) {
    if (/-\d{8}$/.test(model) && all.has(model.replace(/-\d{8}$/, ""))) continue; // the dated snapshot of an alias that is listed
    const r = classify(model, o.kind);
    if (!r || r.chat === false) continue;
    rows.push({
      model, rule: r.id, label: r.label, rating: r.ratings[work], seen: r.seen.includes(work), start: r.start.includes(work),
      free: !!r.free, cloud: !!r.cloud, price: findPrice(db, model) ?? null, note: r.note,
    });
  }
  const price = (a: Advice) => (a.free ? 0 : a.price?.price_out ?? 1e9);
  const rank = (a: Advice, b: Advice) =>
    Number(b.start) - Number(a.start) || b.rating - a.rating || price(a) - price(b) || a.model.localeCompare(b.model);
  const good = rows.filter((a) => a.rating >= 2).sort(rank);
  const limited = !good.length;
  const picked = limited ? rows.filter((a) => a.rating === 1).sort(rank) : good;
  return { work, limited, rows: picked.slice(0, o.limit ?? 6) };
}

export function registerModelGuide(app: FastifyInstance, db: DB) {
  app.post("/api/model-advice", async (req) => {
    const b = (req.body ?? {}) as { kind?: string; models?: unknown; role?: string; work?: string; context?: string };
    const role = (["planner", "worker", "reviewer"].includes(String(b.role)) ? b.role : "worker") as Role;
    // A developer's work type: the one asked for, else read from its Specialty line.
    const work = ORDER.includes(b.work as Work) ? (b.work as Work) : role === "worker" && typeof b.context === "string" ? guessWork(b.context) : undefined;
    const models = Array.isArray(b.models) ? b.models.map(String).slice(0, 500) : [];
    return advise(db, { kind: String(b.kind ?? ""), models, role, work });
  });

  app.get("/api/model-guide", async () => {
    const stat = db.prepare(`SELECT r.model, r.kind, COUNT(*) AS runs, ROUND(AVG(r.cost_usd), 4) AS avg_cost
      FROM runs r WHERE r.kind IN ('plan','build','review') AND r.status = 'done' AND r.cost_usd IS NOT NULL AND r.model != '' AND r.engine != 'shell'
      GROUP BY r.model, r.kind ORDER BY r.model`).all() as { model: string; kind: string; runs: number; avg_cost: number }[];
    return {
      work: WORK,
      roles: ROLE_WORK,
      models: RULES.filter((r) => r.chat !== false).map((r) => ({
        id: r.id, group: r.group, label: r.label, example: r.example, tier: r.tier, note: r.note, free: !!r.free, cloud: !!r.cloud,
        ratings: r.ratings, seen: r.seen, start: r.start,
        price: findPrice(db, r.example) ?? null,
      })),
      // What the models you actually used cost per run, from your own history.
      history: stat.map((s) => ({ ...s, rule: classify(s.model)?.id ?? null })),
    };
  });
}
