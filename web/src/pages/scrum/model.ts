export type Usage = {
  cost: number; tokens: number; runs: number;
  by_kind: Record<string, { cost: number; tokens: number; runs: number }>; by_model: Record<string, { cost: number; tokens: number; runs: number }>;
};
export type Item = {
  id: number; sprint_id: number | null; title: string; request: string; story: string; acceptance: string; tech_notes: string; paths: string;
  worker: string; points: number | null; priority: number; status: "refining" | "ready" | "in_sprint" | "done" | "dropped" | "error";
  step: string; error: string; refining: boolean; cost: number; tokens: number; runs: number;
};
export type Sprint = {
  id: number; pi_id: number | null; chat_id: number | null; number: number; name: string; goal: string; status: "planning" | "active" | "done" | "released";
  branch: string; capacity: number; release_notes: string; security_verdict: string; security_report: string; busy: boolean; usage: Usage | null;
  started_at: string | null; released_at: string | null;
};
export type Pi = { id: number; name: string; goal: string; status: "active" | "closed"; usage: Usage | null };
export type ScrumTask = { id: number; item_id: number | null; sprint_id: number; title: string; status: string; round: number; worker: string | null; cost_usd: number; error: string; chat_id: number };
export type Overview = {
  project: { id: number; name: string; process: string; points_per_dev: number };
  cycle: { step: string; text: string; sprint_id: number | null };
  capacity: { developers: number; points_per_dev: number; capacity: number };
  pis: Pi[]; sprints: Sprint[]; items: Item[]; tasks: ScrumTask[]; unplanned: Usage;
};
export type Preview = { capacity: number; used: number; items: { id: number; title: string; points: number | null; selected: boolean; too_big: boolean }[]; selected: number[] };

export type Sel = { k: "item" | "sprint" | "pi" | "task" | "new"; id: number };
export type Tab = "backlog" | "coming" | "current" | "releases";
export type Group = { pi: Pi | null; sprints: Sprint[] };

export const SIZES = [1, 2, 3, 5, 8, 13];
export const KIND: Record<string, string> = { backlog: "product manager", refine: "refinement", build: "development", review: "QA", security: "security review", notes: "release notes", plan: "planning", checks: "checks" };
export const STEP: Record<string, string> = { product: "product manager drafting", architect: "architect adding technical notes", estimate: "developer estimating" };
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
export const sprintName = (s: Sprint) => (/^sprint\b/i.test(s.name) ? s.name : `Sprint ${s.number}: ${s.name}`);
export const isLive = (s: Sprint) => s.status === "active" || s.status === "done";
export const same = (a: Sel | null, b: Sel) => !!a && a.k === b.k && a.id === b.id;

export const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "backlog", label: "Backlog", hint: "Items not yet finished, by priority" },
  { id: "coming", label: "Coming PI", hint: "PIs and sprints that are planned but not started" },
  { id: "current", label: "Current PI", hint: "The PI being delivered: its sprints and their tasks" },
  { id: "releases", label: "Releases", hint: "Released sprints with release notes and security review" },
];

export function groupsByTab(d: Overview): Record<"coming" | "current" | "releases", Group[]> {
  const asc = (a: Sprint, b: Sprint) => a.number - b.number;
  const known = new Set(d.pis.map((p) => p.id));
  const loose = d.sprints.filter((s) => !s.pi_id || !known.has(s.pi_id));
  const coming: Group[] = [], current: Group[] = [], releases: Group[] = [];
  for (const pi of d.pis) {
    const own = d.sprints.filter((s) => s.pi_id === pi.id).sort(asc);
    const where = own.some(isLive) ? "current" : pi.status === "closed" ? "closed" : own.some((s) => s.status === "released") ? "current" : "coming";
    if (where === "current") current.push({ pi, sprints: own });
    else if (where === "coming") coming.push({ pi, sprints: own });
    const rel = own.filter((s) => s.status === "released").sort((a, b) => b.number - a.number);
    if (rel.length) releases.push({ pi, sprints: rel });
  }
  const plan = loose.filter((s) => s.status === "planning").sort(asc);
  const live = loose.filter(isLive).sort(asc);
  const rel = loose.filter((s) => s.status === "released").sort((a, b) => b.number - a.number);
  if (plan.length) coming.push({ pi: null, sprints: plan });
  if (live.length) current.push({ pi: null, sprints: live });
  if (rel.length) releases.push({ pi: null, sprints: rel });
  return { coming, current, releases };
}

export function sprintOfTask(d: Overview, taskId: number): Sprint | undefined {
  const sid = d.tasks.find((t) => t.id === taskId)?.sprint_id;
  return d.sprints.find((s) => s.id === sid);
}
