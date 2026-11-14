import type { DB } from "./db.ts";
import { json } from "./db.ts";
import type { TranscriptEntry } from "./engines/types.ts";

/**
 * A task as one Markdown text: what it was asked, what each round did (every tool call with its result), the checks
 * and why it stopped. For handing a task to someone who cannot open the screen (a bug report, a review).
 * Long outputs are cut so the file stays readable; the text can contain output from the user's own project, so it is
 * only ever offered as a download, never sent anywhere.
 */
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);
const fence = (s: string) => `\`\`\`\n${s.replace(/```/g, "'''")}\n\`\`\``;

export function stepToMarkdown(e: TranscriptEntry): string {
  switch (e.kind) {
    case "instructions": return `<details><summary>Instructions (${(e.text ?? "").length} characters)</summary>\n\n${fence(cut(e.text ?? "", 6000))}\n\n</details>`;
    case "prompt": return `<details><summary>Task sent to the agent (${(e.text ?? "").length} characters)</summary>\n\n${fence(cut(e.text ?? "", 8000))}\n\n</details>`;
    case "thinking": return "";
    case "model": return e.text ? `**Agent:** ${cut(e.text, 4000)}` : "";
    case "note": return `*${cut(e.text ?? "", 1000)}*`;
    case "error": return `**Error:** ${cut(e.text ?? "", 3000)}`;
    case "tool": {
      const input = typeof e.input === "string" ? e.input : JSON.stringify(e.input ?? {});
      return `**Tool \`${e.tool ?? "?"}\`**${e.isError ? " (error)" : ""}${e.ms ? ` · ${e.ms} ms` : ""}\n${fence(cut(input, 1500))}\n${e.output ? fence(cut(e.output, 2500)) : ""}`;
    }
  }
}

/** The columns of a task and of its runs that the export reads. */
type TaskExportRow = {
  id: number; slug: string; title: string; status: string; project: string | null; branch: string | null; round: number;
  worker: string | null; reviewer: string | null; sprint_number: number | null; paths: string; cost_usd: number; tokens: number;
  created_at: string; updated_at: string; error: string; feedback: string; summary: string; review: string; verdict: string; spec: string;
};
type RunExportRow = {
  kind: string; round: number; agent: string | null; model: string | null; status: string; turns: number; seconds: number;
  cost_usd: number; transcript: string | null; summary: string;
};

export function taskToMarkdown(db: DB, taskId: number): string | null {
  const t = db.prepare(`SELECT t.*, p.name AS project, w.name AS worker, r.name AS reviewer, s.number AS sprint_number
    FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN agents w ON w.id = t.worker_id
    LEFT JOIN agents r ON r.id = t.reviewer_id LEFT JOIN sprints s ON s.id = t.sprint_id WHERE t.id = ?`).get(taskId) as TaskExportRow | undefined;
  if (!t) return null;
  const out: string[] = [];
  out.push(`# ${t.title}`, "");
  out.push(`| | |\n|---|---|`);
  for (const [k, v] of [
    ["Task", `#${t.id} (${t.slug})`], ["Status", t.status], ["Project", t.project], ["Branch", t.branch], ["Round", t.round + 1],
    ["Developer", t.worker], ["Reviewer", t.reviewer], ["Sprint", t.sprint_number], ["Allowed paths", json.parse<string[]>(t.paths, []).join(", ")],
    ["Cost", `$${Number(t.cost_usd).toFixed(4)}`], ["Tokens", t.tokens], ["Created", t.created_at], ["Updated", t.updated_at],
  ] as [string, unknown][]) if (v !== undefined && v !== null && v !== "") out.push(`| ${k} | ${String(v).replace(/\|/g, "\\|")} |`);
  if (t.error) out.push("", "## Problem", "", fence(cut(t.error, 6000)));
  if (t.feedback) out.push("", "## Feedback for the next round", "", cut(t.feedback, 4000));
  if (t.summary) out.push("", "## Developer's summary", "", cut(t.summary, 6000));
  if (t.review) out.push("", `## Review${t.verdict ? ` (${t.verdict})` : ""}`, "", cut(t.review, 6000));
  if (t.spec) out.push("", "## Spec", "", cut(t.spec, 8000));

  const runs = db.prepare(`SELECT r.*, a.name AS agent FROM runs r LEFT JOIN agents a ON a.id = r.agent_id WHERE r.task_id = ? ORDER BY r.id`).all(taskId) as RunExportRow[];
  out.push("", "## Activity", "");
  let budget = 350_000; // characters for all runs together
  for (const r of runs) {
    out.push(`### ${r.kind} · round ${r.round + 1}${r.agent ? ` · ${r.agent}` : ""}${r.model ? ` · ${r.model}` : ""}`, "",
      `${r.status}${r.turns ? ` · ${r.turns} turns` : ""}${r.seconds ? ` · ${r.seconds} s` : ""}${r.cost_usd ? ` · $${Number(r.cost_usd).toFixed(4)}` : ""}`, "");
    const steps = json.parse<TranscriptEntry[]>(r.transcript, []);
    for (const e of steps) {
      if (budget <= 0) { out.push("*(the rest of the activity was left out: the export is too long)*", ""); break; }
      const text = stepToMarkdown(e);
      if (text) { out.push(text, ""); budget -= text.length; }
    }
    if (!steps.length && r.summary) out.push(cut(String(r.summary), 3000), "");
  }
  return out.join("\n");
}
