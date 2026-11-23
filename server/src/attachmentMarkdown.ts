import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import mammoth from "mammoth";
import { NodeHtmlMarkdown } from "node-html-markdown";
import readXlsxFile from "read-excel-file/node";
import { extractText, getDocumentProxy } from "unpdf";
import { getSettings, type DB } from "./db.ts";
import { DEFAULT_RULES, parseRules, ruleKindFor, type AttachmentRules } from "./attachmentRules.ts";

/**
 * A Markdown copy of a chat attachment, written once next to the original.
 * The original bytes are never changed. Text is copied here. Excel, Word and PDF
 * use the libraries pinned in the server package (read-excel-file, mammoth,
 * node-html-markdown, unpdf). Old .xls and .doc files are left named only.
 */

/** One part is about this many characters. A part ends on a newline when one sits near the end. */
export const PART_CHARS = 20_000;

const TEXT_EXT = new Set([".txt", ".md", ".json", ".xml", ".xsl", ".xslt", ".csv", ".tsv", ".log", ".yaml", ".yml", ".ini", ".toml",
  ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".cs", ".java", ".sql", ".ps1", ".sh", ".bat", ".cmd", ".config"]);

/** Rows kept per sheet, including the header. Further rows are counted in the cut line. */
export const SHEET_ROW_CAP = 200;
/** Columns kept per sheet. Further columns are counted in the cut line. */
export const SHEET_COL_CAP = 20;

export type TextKind = "csv" | "tsv" | "copy" | "xlsx" | "docx" | "pdf" | "";

/** csv and tsv get a column header. copy is the text as it is. xlsx, docx and pdf use a library. Empty means this upload is not copied. */
export function textKind(name: string, mime: string): TextKind {
  const ext = extname(name).toLowerCase();
  const m = mime.toLowerCase();
  if (ext === ".xlsx" || m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (ext === ".docx" || m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === ".pdf" || m === "application/pdf") return "pdf";
  if (ext === ".csv" || m === "text/csv" || m === "application/csv") return "csv";
  if (ext === ".tsv" || m === "text/tab-separated-values" || m === "text/tsv") return "tsv";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml" || m === "text/xml" || TEXT_EXT.has(ext)) return "copy";
  return "";
}

export type Conversion = { status: string; markdown: string | null };

function failed(reason: string): Conversion {
  const clean = reason.replace(/\s+/g, " ").replace(/https?:\/\/\S+/g, "").replace(/^Error:\s*/, "").trim().replace(/[.:\s]+$/, "").slice(0, 160) || "could not be read";
  return { status: `failed: ${clean}`, markdown: null };
}

/** Strict UTF-8. A binary file renamed to .txt fails here and the message still sends. */
export function decodeUtf8(bytes: Buffer): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Records in a CSV or TSV file. Quotes follow the usual rule: a quote doubles inside a quoted field,
 * and a newline inside quotes does not end the row.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) {
      row.push(field); field = ""; rows.push(row); row = [];
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
  return rows;
}

function tableHeader(text: string, delimiter: string): string {
  const rows = parseDelimited(text, delimiter);
  if (!rows.length) return "Columns: (none)\nRows: 0\n\n";
  const columns = rows[0].map((c) => c.trim()).filter(Boolean);
  const dataRows = Math.max(0, rows.length - 1);
  return `Columns: ${columns.join(", ") || "(none)"}\nRows: ${dataRows} (not counting the header)\n\n`;
}

function convertText(kind: "csv" | "tsv" | "copy", bytes: Buffer): Conversion {
  let text: string;
  try { text = decodeUtf8(bytes); }
  catch { return failed("not valid UTF-8"); }
  const header = kind === "csv" ? tableHeader(text, ",") : kind === "tsv" ? tableHeader(text, "\t") : "";
  return { status: "converted", markdown: header + text };
}

type Cell = string | number | boolean | Date | null;
export type SheetRows = { name: string; rows: Cell[][] };

function cellText(value: Cell | undefined): string {
  if (value == null) return "";
  const raw = value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : String(value);
  return raw.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function cutLine(rows: number, cols: number): string {
  const bits = [
    rows ? `${rows} ${rows === 1 ? "row" : "rows"}` : "",
    cols ? `${cols} ${cols === 1 ? "column" : "columns"}` : "",
  ].filter(Boolean);
  return bits.length ? `Cut ${bits.join(" and ")}.` : "";
}

/** One Markdown table per sheet. Rows and columns past the caps are counted, not included. */
export function sheetsToMarkdown(
  sheets: SheetRows[],
  caps: { maxRows: number; maxCols: number } = { maxRows: SHEET_ROW_CAP, maxCols: SHEET_COL_CAP },
): Conversion {
  if (!sheets.length) return { status: "converted", markdown: "(empty workbook)" };
  let cut = false;
  const parts = sheets.map((sheet) => {
    const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
    const cutRows = Math.max(0, sheet.rows.length - caps.maxRows);
    const cutCols = Math.max(0, width - caps.maxCols);
    if (cutRows || cutCols) cut = true;
    const kept = sheet.rows.slice(0, caps.maxRows).map((row) => row.slice(0, caps.maxCols));
    const name = sheet.name.replace(/\s+/g, " ").trim() || "Sheet";
    let body: string;
    if (!kept.length) body = "(empty sheet)";
    else {
      const cols = Math.max(1, ...kept.map((row) => row.length));
      const line = (row: Cell[]) => `| ${Array.from({ length: cols }, (_, i) => cellText(row[i])).join(" | ")} |`;
      body = [line(kept[0]), `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`, ...kept.slice(1).map(line)].join("\n");
    }
    const note = cutLine(cutRows, cutCols);
    return `## ${name}\n\n${body}${note ? `\n\n${note}` : ""}`;
  });
  return { status: cut ? "truncated" : "converted", markdown: parts.join("\n\n") };
}

async function convertXlsx(bytes: Buffer, caps: { maxRows: number; maxCols: number }): Promise<Conversion> {
  const sheets = await readXlsxFile(bytes);
  return sheetsToMarkdown(sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data })), caps);
}

const htmlToMarkdown = new NodeHtmlMarkdown();

async function convertDocx(bytes: Buffer): Promise<Conversion> {
  const html = await mammoth.convertToHtml({ buffer: bytes }, {
    convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
  });
  const markdown = htmlToMarkdown.translate(html.value).trim();
  return { status: "converted", markdown: markdown || "(empty document)" };
}

/** A page of only whitespace is not a text layer. An image-only file is needs_ocr, and nothing is guessed. */
export function pdfPagesToMarkdown(pages: string[]): Conversion {
  const hasText = pages.some((page) => page.replace(/\s+/g, "").length > 0);
  if (!pages.length || !hasText) return { status: "needs_ocr", markdown: null };
  const markdown = pages.map((page, i) => {
    const text = page.trim();
    return `## Page ${i + 1}\n\n${text || "(no text on this page)"}`;
  }).join("\n\n");
  return { status: "converted", markdown };
}

async function convertPdf(bytes: Buffer): Promise<Conversion> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pdfPagesToMarkdown(pages);
}

/**
 * Markdown for an upload, or null when this type is not copied (images, old .xls, old .doc,
 * or a type whose rule is switched off). status is `converted`, `truncated`, `failed: reason`, or `needs_ocr`.
 */
export async function convertUpload(name: string, mime: string, bytes: Buffer, rules: AttachmentRules = DEFAULT_RULES): Promise<Conversion | null> {
  const kind = textKind(name, mime);
  if (!kind) return null;
  const rk = ruleKindFor(kind);
  if (!rk || !rules[rk].enabled) return null;
  try {
    if (kind === "csv" || kind === "tsv" || kind === "copy") return convertText(kind, bytes);
    if (kind === "xlsx") {
      return await convertXlsx(bytes, {
        maxRows: rules.xlsx.maxRows ?? SHEET_ROW_CAP,
        maxCols: rules.xlsx.maxCols ?? SHEET_COL_CAP,
      });
    }
    if (kind === "docx") return await convertDocx(bytes);
    return await convertPdf(bytes);
  } catch (err) {
    return failed(String((err as Error).message ?? err));
  }
}

/** The copy sits beside the original: data/attachments/<chat id>/<id>.md */
export function markdownPath(row: { id: number; path: string }): string {
  return join(dirname(row.path), `${row.id}.md`);
}

/** Characters per part for this file's type, from the rules. Files that are not copied use {@link PART_CHARS}. */
export function partSizeFor(name: string, rules: AttachmentRules = DEFAULT_RULES): number {
  const rk = ruleKindFor(textKind(name, ""));
  if (!rk) return PART_CHARS;
  return rules[rk].partChars ?? PART_CHARS;
}

/**
 * Split a Markdown copy into parts of about {@link PART_CHARS} characters.
 * Joining the parts gives the copy back, with nothing repeated and nothing dropped.
 */
export function splitParts(markdown: string, size = PART_CHARS): string[] {
  if (!markdown.length) return [""];
  const parts: string[] = [];
  let i = 0;
  while (i < markdown.length) {
    let end = Math.min(markdown.length, i + size);
    if (end < markdown.length) {
      const nl = markdown.lastIndexOf("\n", end - 1);
      if (nl >= i + size - 2_000 && nl > i) end = nl + 1;
    }
    if (end <= i) end = Math.min(markdown.length, i + size);
    parts.push(markdown.slice(i, end));
    i = end;
  }
  return parts;
}

/** `part 2 of 5`, then that part's text. Part numbers start at 1. */
export function formatPart(markdown: string, part: number, size = PART_CHARS): string {
  const parts = splitParts(markdown, size);
  const n = Number(part);
  if (!Number.isInteger(n) || n < 1 || n > parts.length) throw new Error(`Part ${part} is outside 1 to ${parts.length}.`);
  return `part ${n} of ${parts.length}\n\n${parts[n - 1]}`;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function partsPhrase(status: string, parts: number | null): string {
  if (status.startsWith("failed:")) return "failed";
  if (status === "needs_ocr") return "needs a text scan";
  if (parts && (status === "converted" || status === "truncated")) return `${parts} ${parts === 1 ? "part" : "parts"}`;
  return "no text";
}

/** How many parts the copy has, or null when there is no copy on disk. */
export function partsOnDisk(row: { id: number; path: string; status?: string; name?: string }, rules?: AttachmentRules): number | null {
  const status = row.status ?? "";
  if (status !== "converted" && status !== "truncated") return null;
  const md = markdownPath(row);
  if (!row.path || !existsSync(md)) return null;
  return splitParts(readFileSync(md, "utf8"), partSizeFor(row.name ?? "", rules)).length;
}

/** One line for an older message: name, size, and how many parts the agent can ask for. */
export function earlierFileSummary(rows: { id: number; name: string; size: number; path: string; status?: string }[], rules?: AttachmentRules): string {
  return rows.map((r) => `${r.name}, ${formatSize(r.size)}, ${partsPhrase(r.status ?? "", partsOnDisk(r, rules))}`).join("; ");
}

/**
 * The Markdown copy of one attachment in this chat. The name is the name the user gave the file.
 * A path, or a name from another chat, is refused.
 */
export function readChatAttachment(db: DB, chatId: number, name: string, part = 1): string {
  const clean = String(name ?? "").trim();
  if (!clean || /[\\/]/.test(clean) || clean.includes("..")) throw new Error("Give an attachment name from this chat, not a path.");
  const rows = db.prepare("SELECT id, name, path, status FROM attachments WHERE chat_id = ? AND name = ? ORDER BY id DESC")
    .all(chatId, clean) as { id: number; name: string; path: string; status: string }[];
  if (!rows.length) throw new Error(`No attachment named "${clean}" in this chat.`);
  const row = rows[0];
  const which = rows.length > 1 ? `Latest of ${rows.length} files named ${clean} in this chat.\n\n` : "";
  if (row.status.startsWith("failed:")) throw new Error(`${which}${clean} was not converted: ${row.status.slice("failed:".length).trim()}`);
  if (row.status === "needs_ocr") throw new Error(`${which}${clean} has no text layer yet.`);
  const md = markdownPath(row);
  if ((row.status !== "converted" && row.status !== "truncated") || !row.path || !existsSync(md)) {
    throw new Error(`${which}No Markdown copy for ${clean}.`);
  }
  const rules = parseRules(getSettings(db).attachment_rules);
  return which + formatPart(readFileSync(md, "utf8"), part, partSizeFor(row.name, rules));
}
