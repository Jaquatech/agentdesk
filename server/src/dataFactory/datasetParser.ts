/**
 * Reads an uploaded dataset (JSON Lines, a JSON array of objects, or CSV) into test cases. Pure: no database, no
 * network. Every problem in the file is collected and none stops the parse. Line numbers are 1-based: for JSON Lines
 * the physical line, for a JSON array the element's position, for CSV the physical line where a record starts (so a
 * quoted newline does not shift the numbers after it).
 */

export type DatasetFormat = "jsonl" | "json" | "csv";

export type DatasetCase = {
  id: string;
  input: string;
  expected?: string;
  tags: string[];
  meta: Record<string, string>;
};

export type DatasetProblem = { line: number; message: string };

export type DatasetResult = { cases: DatasetCase[]; problems: DatasetProblem[] };

/** Longest input (in UTF-16 code units) that datasetWarnings accepts without a note. */
export const MAX_INPUT_CHARS = 20000;

const KNOWN_KEYS = new Set(["input", "id", "expected", "tags"]);

/** One record as read from the file, before validation. */
type RawRecord = { line: number; value: unknown };

/** A record that passed the field checks, before ids are assigned. */
type CheckedCase = {
  line: number;
  id?: string;
  input: string;
  expected?: string;
  tags: string[];
  meta: Record<string, string>;
};

export function parseDataset(text: string, format: DatasetFormat): DatasetResult {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const problems: DatasetProblem[] = [];
  let records: RawRecord[];
  if (format === "jsonl") records = readJsonLines(body, problems);
  else if (format === "json") records = readJsonArray(body, problems);
  else if (format === "csv") records = readCsv(body, problems);
  else throw new Error(`unknown dataset format: ${String(format)}`);
  const cases = buildCases(records, problems);
  problems.sort((a, b) => a.line - b.line);
  return { cases, problems };
}

/** Plain-language notes on a parsed dataset: what it may be missing. Empty when nothing stands out. */
export function datasetWarnings(cases: DatasetCase[]): string[] {
  const notes: string[] = [];
  if (cases.length > 0 && cases.every((c) => c.expected === undefined)) {
    notes.push("No case has an expected answer, so scoring will need a judge.");
  }
  if (cases.length < 5) {
    notes.push(`Only ${cases.length} case${cases.length === 1 ? "" : "s"}. Five or more give a more useful score.`);
  }
  const idsByInput = new Map<string, string[]>();
  for (const c of cases) {
    const ids = idsByInput.get(c.input);
    if (ids) ids.push(c.id);
    else idsByInput.set(c.input, [c.id]);
  }
  for (const ids of idsByInput.values()) {
    if (ids.length > 1) notes.push(`${ids.length} cases have the same input: ${ids.join(", ")}.`);
  }
  for (const c of cases) {
    if (c.input.length > MAX_INPUT_CHARS) {
      notes.push(`Case "${c.id}" has an input of ${c.input.length} characters; the limit is ${MAX_INPUT_CHARS}.`);
    }
  }
  const suspicious = cases.filter(looksDamaged).map((c) => c.id);
  if (suspicious.length > 0) {
    const shown = suspicious.slice(0, 5).join(", ");
    const more = suspicious.length > 5 ? ` and ${suspicious.length - 5} more` : "";
    const count = suspicious.length === 1 ? "1 case contains" : `${suspicious.length} cases contain`;
    notes.push(
      `${count} characters that suggest a damaged file or a wrong encoding: ${shown}${more}. Check the file's encoding before using it.`,
    );
  }
  return notes;
}

/** Double encoding and byte order mark bytes read as Windows-1252 (written as escapes on purpose). */
const MOJIBAKE = /\u00ff\u00fe|\u00fe\u00ff|\u00c3[\u0080-\u00bf]|\u00e2\u20ac/;

function badCodePoint(code: number): boolean {
  if (code === 0xfffd) return true;
  if (code <= 0x08 || code === 0x0b || code === 0x0c) return true;
  return (code >= 0x0e && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}

function textLooksDamaged(text: string): boolean {
  if (MOJIBAKE.test(text)) return true;
  for (let i = 0; i < text.length; i++) {
    if (badCodePoint(text.charCodeAt(i))) return true;
  }
  return false;
}

/** True when the input, expected answer, a tag or a meta value holds characters that point to a damaged file. */
function looksDamaged(c: DatasetCase): boolean {
  return (
    textLooksDamaged(c.input) ||
    (c.expected !== undefined && textLooksDamaged(c.expected)) ||
    c.tags.some(textLooksDamaged) ||
    Object.values(c.meta).some(textLooksDamaged)
  );
}

function readJsonLines(body: string, problems: DatasetProblem[]): RawRecord[] {
  const records: RawRecord[] = [];
  body.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    try {
      records.push({ line, value: JSON.parse(raw) });
    } catch {
      problems.push({ line, message: "not valid JSON" });
    }
  });
  return records;
}

function readJsonArray(body: string, problems: DatasetProblem[]): RawRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    problems.push({ line: jsonErrorLine(body, error), message: "the file is not valid JSON" });
    return [];
  }
  if (!Array.isArray(parsed)) {
    problems.push({ line: 1, message: "the file must hold a JSON array of objects" });
    return [];
  }
  return parsed.map((value, index) => ({ line: index + 1, value }));
}

/** V8 reports the failing character as "position N"; turn that into a line number, or 1 when it does not say. */
function jsonErrorLine(body: string, error: unknown): number {
  const match = /position (\d+)/.exec(error instanceof Error ? error.message : "");
  if (!match) return 1;
  return body.slice(0, Number(match[1])).split("\n").length;
}

function readCsv(body: string, problems: DatasetProblem[]): RawRecord[] {
  const rows = csvRows(body, problems);
  if (rows.length === 0) {
    problems.push({ line: 1, message: "the file has no header row" });
    return [];
  }
  const header = rows[0].fields.map((name) => name.trim());
  if (!header.includes("input")) {
    problems.push({ line: rows[0].line, message: 'the header has no "input" column' });
    return [];
  }
  const records: RawRecord[] = [];
  for (const row of rows.slice(1)) {
    if (row.fields.length !== header.length) {
      problems.push({
        line: row.line,
        message: `the row has ${row.fields.length} columns; the header has ${header.length}`,
      });
      continue;
    }
    const value: Record<string, string> = {};
    header.forEach((name, i) => {
      value[name] = row.fields[i];
    });
    records.push({ line: row.line, value });
  }
  return records;
}

type CsvRow = { line: number; fields: string[] };

/** RFC 4180 style: comma separated, double quotes escape a quote (""), quoted fields may hold commas and newlines. */
function csvRows(text: string, problems: DatasetProblem[]): CsvRow[] {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1; // physical line of the current character
  let rowLine = 1; // line where the current record starts
  let quoteLine = 1; // line where the open quoted field starts
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
      quoteLine = line;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      rows.push({ line: rowLine, fields });
      fields = [];
      field = "";
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (quoted) problems.push({ line: quoteLine, message: "a quoted field is never closed" });
  if (quoted || field !== "" || fields.length > 0) {
    fields.push(field);
    rows.push({ line: rowLine, fields });
  }
  // Blank lines carry no case; skip them without a problem, as JSON Lines does.
  return rows.filter((row) => !(row.fields.length === 1 && row.fields[0].trim() === ""));
}

function buildCases(records: RawRecord[], problems: DatasetProblem[]): DatasetCase[] {
  const checked: CheckedCase[] = [];
  for (const { line, value } of records) {
    if (!isObject(value)) {
      problems.push({ line, message: "not an object" });
      continue;
    }
    const input = asText(value.input);
    if (input.trim() === "") {
      problems.push({ line, message: "no input text" });
      continue;
    }
    const id = asText(value.id).trim();
    const expected = asText(value.expected);
    const meta: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!KNOWN_KEYS.has(key) && key !== "__proto__") meta[key] = asText(item);
    }
    checked.push({
      line,
      id: id === "" ? undefined : id,
      input,
      expected: expected.trim() === "" ? undefined : expected,
      tags: asTags(value.tags),
      meta,
    });
  }

  // Ids the file names are reserved first, so a generated case-N never takes one of them.
  const named = new Set(checked.flatMap((c) => (c.id === undefined ? [] : [c.id])));
  const ownerLine = new Map<string, number>();
  const cases: DatasetCase[] = [];
  let next = 1;
  for (const item of checked) {
    let id = item.id;
    if (id === undefined) {
      while (named.has(`case-${next}`) || ownerLine.has(`case-${next}`)) next++;
      id = `case-${next++}`;
    } else if (ownerLine.has(id)) {
      problems.push({ line: item.line, message: `id "${id}" is already used on line ${ownerLine.get(id)}` });
      continue;
    }
    ownerLine.set(id, item.line);
    const testCase: DatasetCase = { id, input: item.input, tags: item.tags, meta: item.meta };
    if (item.expected !== undefined) testCase.expected = item.expected;
    cases.push(testCase);
  }
  return cases;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text for a field value: strings as they are, numbers and booleans as written, objects and arrays as JSON. */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A JSON array of tags, or a CSV cell with tags separated by semicolons. */
function asTags(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map(asText) : asText(value).split(";");
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}
