import type { ReportCase, RunReport } from "./report.ts";

const SECTION_LIMIT = 100;
const BLOCK_LIMIT = 4000;
const CUT_NOTE = "… (cut; the full text is in the CSV and JSON)";

/** One line of untrusted text, safe inside a heading, table cell or sentence. */
const inline = (s: string) => s.replace(/\r\n|\r|\n/g, " ").replace(/[\\|[\]*_`]/g, "\\$&").replace(/</g, "&lt;");

/** A fenced block whose fence is longer than any backtick run inside. */
function block(text: string, cut: boolean): string {
  let body = text;
  if (cut && body.length > BLOCK_LIMIT) body = `${body.slice(0, BLOCK_LIMIT)}\n${CUT_NOTE}`;
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}`;
}

const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
const secs = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`);
const money = (n: number | null) => (n === null ? "-" : `$${n.toFixed(4)}`);

function caseBlock(c: ReportCase, judged: boolean, withVote: boolean): string {
  const out = [`### ${inline(c.case_key)} · ${inline(c.model)}`, "", "Input:", "", block(c.input, true)];
  if (c.expected !== null) out.push("", "Expected:", "", block(c.expected, true));
  if (c.status === "ok") out.push("", "Answer:", "", block(c.answer, true));
  else if (c.status === "error") out.push("", "Error:", "", block(c.error, true));
  else out.push("", "Answer: missing.");
  if (judged && c.judge) {
    out.push("", c.judge.status === "ok"
      ? `Judge: ${c.judge.score ?? "-"} of 5, ${c.judge.pass ? "Pass" : "Fail"}. ${inline(c.judge.reason)}`
      : `Judge: error. ${inline(c.judge.error)}`);
  }
  if (withVote && c.vote) {
    out.push("", `Your vote: ${c.vote.verdict === "good" ? "Good" : "Bad"}${c.vote.note ? `. ${inline(c.vote.note)}` : ""}`);
  }
  return out.join("\n");
}

function section(title: string, cases: ReportCase[], judged: boolean, withVote: boolean, limit: number): string {
  if (cases.length === 0) return `## ${title}\n\nNone.`;
  const shown = cases.slice(0, limit).map((c) => caseBlock(c, judged, withVote));
  if (cases.length > limit) shown.push(`And ${cases.length - limit} more (see the CSV or JSON).`);
  return `## ${title}\n\n${shown.join("\n\n")}`;
}

export function reportMarkdown(report: RunReport, opts: { all: boolean }): string {
  const { run, dataset, judge, models, cases } = report;
  const judged = judge !== null;
  const parts: string[] = [`# Run report: ${inline(run.name || `Run ${run.id}`)}`];

  const cost = (n: number) => money(n);
  const facts: [string, string][] = [
    ["Dataset", inline(`${dataset.name} v${dataset.version}, ${dataset.case_count} cases`)],
    ["Status", inline(run.stop_reason ? `${run.status} (${run.stop_reason})` : run.status)],
    ["Started", inline(run.started_at ?? "-")],
    ["Ended", inline(run.ended_at ?? "-")],
    ["Judge", judge ? inline(`${judge.provider_name} / ${judge.model}`) : "Not judged"],
    ["Max answer tokens", String(run.max_tokens)],
    ["Cost of tested models", cost(run.cost_usd)],
    ["Cost of judging", judge ? cost(judge.cost_usd) : "-"],
    ["Estimate", run.est_low === null || run.est_high === null ? "-" : `${money(run.est_low)} to ${money(run.est_high)}`],
  ];
  parts.push(["| Fact | Value |", "| --- | --- |", ...facts.map(([k, v]) => `| ${k} | ${v} |`)].join("\n"));

  const sum = (f: (m: (typeof models)[number]) => number) => models.reduce((s, m) => s + f(m), 0);
  const answers = sum((m) => m.answers);
  const missing = sum((m) => m.missing);
  const unknown = sum((m) => m.cost_unknown);
  const notes: string[] = [];
  if (run.status !== "done") notes.push(`The run status is ${inline(run.status)}.`);
  if (missing > 0) notes.push(`${missing} answers are missing.`);
  if (judge && judge.status !== "done") notes.push(`The judge run is ${inline(judge.status)}.`);
  if (!judge) notes.push("The run has not been judged.");
  for (const m of models) if (m.self_preference) notes.push(`${inline(m.model)} was judged by a model of the same family.`);
  if (unknown > 0) notes.push(`${unknown} results have no known cost.`);
  if (answers > 0) notes.push(`Your votes cover ${sum((m) => m.voted)} of ${answers} answers.`);
  parts.push(`## Notes\n\n${notes.length ? notes.map((n) => `- ${n}`).join("\n") : "None."}`);

  const head = "| Model | Answers | Errors | Pass rate | Avg score | Your good rate | Agreement | Avg time | p95 time | Tokens in / out | Cost |";
  const rows = models.map((m) =>
    `| ${inline(`${m.provider_name} / ${m.model}`)} | ${m.answers} | ${m.errors} | ${pct(m.pass_rate)} | ${m.avg_score === null ? "-" : m.avg_score.toFixed(1)} | ${pct(m.good_rate)} | ${pct(m.agreement)} | ${secs(m.avg_ms)} | ${secs(m.p95_ms)} | ${m.tokens_in} / ${m.tokens_out} | ${money(m.cost_usd)}${m.cost_unknown > 0 ? "+" : ""} |`);
  parts.push(`## Models\n\n${[head, `|${" --- |".repeat(11)}`, ...rows].join("\n")}`);

  parts.push(section("Failed by the judge", cases.filter((c) => c.judge?.status === "ok" && c.judge.pass === false), judged, false, SECTION_LIMIT));
  parts.push(section("Errors", cases.filter((c) => c.status === "error"), judged, false, SECTION_LIMIT));
  parts.push(section("You and the judge disagree", cases.filter((c) => c.agrees === false), judged, true, SECTION_LIMIT));
  if (opts.all) parts.push(section("All answers", cases, judged, true, Infinity));

  parts.push(`## System prompt\n\n${run.system_prompt ? block(run.system_prompt, false) : "None."}`);
  if (judge) parts.push(`## Scoring guide\n\n${block(judge.rubric, false)}`);
  return parts.join("\n\n") + "\n";
}
