import writeXlsxFile from "write-excel-file/node";
import type { Cell as XCell } from "write-excel-file/node";
import type { Comparison, Pair, PairCase } from "./compare.ts";
import { cell as csvCell } from "./reportCsv.ts";
import type { Cell } from "./reportCsv.ts";
import { SECTION_LIMIT, block, inline, money, pct, secs } from "./reportMarkdown.ts";
import { bold, cell as xcell, rate } from "./reportXlsx.ts";

export const COMPARE_COLUMNS = [
  "model_pair", "case_key", "change", "input", "expected",
  "status_a", "answer_a", "score_a", "pass_a", "reason_a", "vote_a",
  "status_b", "answer_b", "score_b", "pass_b", "reason_b", "vote_b",
] as const;

const bool = (b: boolean | null): string | null => (b === null ? null : b ? "true" : "false");

function caseRows(c: Comparison): Cell[][] {
  return c.pairs.flatMap((p) => p.cases.map((k): Cell[] => [
    p.label, k.case_key, k.change, k.input, k.expected,
    k.a.status, k.a.answer, k.a.score, bool(k.a.pass), k.a.reason, k.a.vote,
    k.b.status, k.b.answer, k.b.score, bool(k.b.pass), k.b.reason, k.b.vote,
  ]));
}

const runName = (r: Comparison["a"]) => r.run.name || `Run ${r.run.id}`;
const judgeName = (r: Comparison["a"]) => (r.judge ? `${r.judge.provider_name} / ${r.judge.model}` : "Not judged");
const status = (r: Comparison["a"]) => (r.run.stop_reason ? `${r.run.status} (${r.run.stop_reason})` : r.run.status);

/** Facts as [name, A, B] with plain text; shared by Markdown and Excel. */
function facts(c: Comparison): [string, string, string][] {
  const { a, b } = c;
  return [
    ["Run", `${runName(a)} (#${a.run.id})`, `${runName(b)} (#${b.run.id})`],
    ["Dataset", `${a.dataset.name} v${a.dataset.version}`, `${b.dataset.name} v${b.dataset.version}`],
    ["Status", status(a), status(b)],
    ["Judge", judgeName(a), judgeName(b)],
    ["Max answer tokens", String(a.run.max_tokens), String(b.run.max_tokens)],
    ["Cost", money(a.run.cost_usd), money(b.run.cost_usd)],
  ];
}

export function compareCsv(c: Comparison): string {
  const lines = [COMPARE_COLUMNS as readonly Cell[] as Cell[], ...caseRows(c)].map((r) => r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function caseBlock(p: Pair, k: PairCase): string {
  const judge = (s: PairCase["a"], who: string) =>
    s.status === "missing" ? `Judge ${who}: no answer.`
      : s.pass === null ? `Judge ${who}: ${s.reason ? `error. ${inline(s.reason)}` : "none."}`
        : `Judge ${who}: ${s.score ?? "-"} of 5, ${s.pass ? "Pass" : "Fail"}. ${inline(s.reason)}`;
  const answer = (s: PairCase["a"], who: string) =>
    s.status === "ok" ? ["", `Answer ${who}:`, "", block(s.answer, true)]
      : s.status === "error" ? ["", `Error ${who}:`, "", block(s.answer, true)] : ["", `Answer ${who}: missing.`];
  const out = [`### ${inline(k.case_key)} · ${inline(p.label)}`, "", "Input:", "", block(k.input, true)];
  if (k.expected !== null) out.push("", "Expected:", "", block(k.expected, true));
  out.push(...answer(k.a, "A"), ...answer(k.b, "B"), "", judge(k.a, "A"), "", judge(k.b, "B"));
  return out.join("\n");
}

function section(title: string, pairs: Pair[], change: PairCase["change"]): string {
  const all = pairs.flatMap((p) => p.cases.filter((k) => k.change === change).map((k) => ({ p, k })));
  if (all.length === 0) return `## ${title}\n\nNone.`;
  const shown = all.slice(0, SECTION_LIMIT).map(({ p, k }) => caseBlock(p, k));
  if (all.length > SECTION_LIMIT) shown.push(`And ${all.length - SECTION_LIMIT} more (see the CSV or JSON).`);
  return `## ${title}\n\n${shown.join("\n\n")}`;
}

export function compareMarkdown(c: Comparison): string {
  const parts: string[] = [`# Compare: ${inline(runName(c.a))} and ${inline(runName(c.b))}`];
  parts.push(["| Fact | A | B |", "| --- | --- | --- |", ...facts(c).map(([k, x, y]) => `| ${k} | ${inline(x)} | ${inline(y)} |`)].join("\n"));
  parts.push(`## Warnings\n\n${c.warnings.length ? c.warnings.map((w) => `- ${inline(w)}`).join("\n") : "None."}`);

  const rows: string[] = [];
  const counts: string[] = [];
  for (const p of c.pairs) {
    for (const [who, s] of [["A", p.a], ["B", p.b]] as const) {
      rows.push(`| ${inline(p.label)} | ${who} | ${s.answers} | ${s.errors} | ${s.judged} | ${pct(s.pass_rate)} | ${s.avg_score === null ? "-" : s.avg_score.toFixed(1)} | ${pct(s.good_rate)} | ${secs(s.avg_ms)} | ${money(s.cost_usd)} |`);
    }
    const n = p.counts;
    counts.push(`- ${inline(p.label)}: ${p.shared} shared cases; fixed ${n.fixed}, broke ${n.broke}, same pass ${n.same_pass}, same fail ${n.same_fail}, not judged ${n.unjudged}. Changed input ${p.changed_input}, only in A ${p.only_a_cases}, only in B ${p.only_b_cases}.`);
  }
  const fig = c.pairs.length
    ? [["| Models | Run | Answers | Errors | Judged | Pass rate | Avg score | Your good rate | Avg time | Cost |", `|${" --- |".repeat(10)}`, ...rows].join("\n"), counts.join("\n")]
    : ["No model is in both runs."];
  if (c.only_a.length) fig.push(`Only in A: ${c.only_a.map(inline).join(", ")}.`);
  if (c.only_b.length) fig.push(`Only in B: ${c.only_b.map(inline).join(", ")}.`);
  parts.push(`## Figures\n\n${fig.join("\n\n")}`);

  parts.push(section("Broke", c.pairs, "broke"));
  parts.push(section("Fixed", c.pairs, "fixed"));
  parts.push(`## System prompt A\n\n${c.a.run.system_prompt ? block(c.a.run.system_prompt, false) : "None."}`);
  parts.push(`## System prompt B\n\n${c.b.run.system_prompt ? block(c.b.run.system_prompt, false) : "None."}`);
  return parts.join("\n\n") + "\n";
}

/** The comparison as a workbook: Summary, Figures, Cases. Text is always stored as text. */
export async function compareXlsx(c: Comparison): Promise<Buffer> {
  const summary: XCell[][] = [
    [bold("Fact"), bold("A"), bold("B")],
    ...facts(c).map(([k, x, y]) => [bold(k), xcell(x), xcell(y)]),
    [bold("System prompt"), xcell(c.a.run.system_prompt), xcell(c.b.run.system_prompt)],
    [bold("Scoring guide"), xcell(c.a.judge?.rubric ?? null), xcell(c.b.judge?.rubric ?? null)],
    [],
    [bold("Warnings")],
    ...(c.warnings.length ? c.warnings.map((w): XCell[] => [xcell(w)]) : [[xcell("None.")]]),
  ];
  const head = ["Models", "Run", "Answers", "Errors", "Judged", "Pass rate", "Avg score", "Good rate", "Avg ms", "Cost USD",
    "Shared cases", "Fixed", "Broke", "Same pass", "Same fail", "Not judged", "Changed input", "Only in A", "Only in B"];
  const figures: XCell[][] = c.pairs.flatMap((p) => (["A", "B"] as const).map((who): XCell[] => {
    const s = who === "A" ? p.a : p.b;
    const tail = who === "A"
      ? [p.shared, p.counts.fixed, p.counts.broke, p.counts.same_pass, p.counts.same_fail, p.counts.unjudged, p.changed_input, p.only_a_cases, p.only_b_cases].map((n) => xcell(n))
      : Array<XCell>(9).fill(null);
    return [xcell(p.label), xcell(who), xcell(s.answers), xcell(s.errors), xcell(s.judged), rate(s.pass_rate), xcell(s.avg_score), rate(s.good_rate),
      xcell(s.avg_ms), xcell(s.cost_usd), ...tail];
  }));
  for (const m of c.only_a) figures.push([xcell(m), xcell("only in A")]);
  for (const m of c.only_b) figures.push([xcell(m), xcell("only in B")]);
  const cases: XCell[][] = caseRows(c).map((row) => row.map((v) => xcell(v)));
  return writeXlsxFile([
    { data: summary, sheet: "Summary", columns: [{ width: 28 }, { width: 60 }, { width: 60 }] },
    { data: [head.map(bold), ...figures], sheet: "Figures", columns: head.map((h) => ({ width: Math.max(12, h.length + 2) })) },
    { data: [COMPARE_COLUMNS.map(bold), ...cases], sheet: "Cases", columns: COMPARE_COLUMNS.map((h) => ({ width: Math.max(12, h.length + 2) })) },
  ]).toBuffer();
}
