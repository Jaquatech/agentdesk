import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { DB } from "./db.ts";

/**
 * A Markdown copy of a chat attachment, written once next to the original.
 * The original bytes are never changed. Excel, Word and PDF are not copied here:
 * that waits on a library the owner has not approved yet.
 */

/** One part is about this many characters. A part ends on a newline when one sits near the end. */
export const PART_CHARS = 20_000;

const TEXT_EXT = new Set([".txt", ".md", ".json", ".xml", ".xsl", ".xslt", ".csv", ".tsv", ".log", ".yaml", ".yml", ".ini", ".toml",
  ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".cs", ".java", ".sql", ".ps1", ".sh", ".bat", ".cmd", ".config"]);

export type TextKind = "csv" | "tsv" | "copy" | "";

/** csv and tsv get a column header. copy is the text as it is. Empty means this upload is not copied. */
export function textKind(name: string, mime: string): TextKind {
  const ext = extname(name).toLowerCase();
  const m = mime.toLowerCase();
  if (ext === ".csv" || m === "text/csv" || m === "application/csv") return "csv";
  if (ext === ".tsv" || m === "text/tab-separated-values" || m === "text/tsv") return "tsv";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml" || m === "text/xml" || TEXT_EXT.has(ext)) return "copy";
  return "";
}

export type Conversion = { status: string; markdown: string | null };

function failed(reason: string): Conversion {
  const clean = reason.replace(/\s+/g, " ").trim().slice(0, 160) || "could not be read";
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

/**
 * Markdown for a text upload, or null when this type is not copied (images, PDF, Word, Excel).
 * status is `converted` or `failed: reason`. `truncated` is reserved for the capped spreadsheet copy.
 */
export function convertUpload(name: string, mime: string, bytes: Buffer): Conversion | null {
  const kind = textKind(name, mime);
  if (!kind) return null;
  let text: string;
  try { text = decodeUtf8(bytes); }
  catch { return failed("not valid UTF-8"); }
  try {
    const header = kind === "csv" ? tableHeader(text, ",") : kind === "tsv" ? tableHeader(text, "\t") : "";
    return { status: "converted", markdown: header + text };
  } catch (err) {
    return failed(String((err as Error).message ?? err));
  }
}

/** The copy sits beside the original: data/attachments/<chat id>/<id>.md */
export function markdownPath(row: { id: number; path: string }): string {
  return join(dirname(row.path), `${row.id}.md`);
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
export function partsOnDisk(row: { id: number; path: string; status?: string }): number | null {
  const status = row.status ?? "";
  if (status !== "converted" && status !== "truncated") return null;
  const md = markdownPath(row);
  if (!row.path || !existsSync(md)) return null;
  return splitParts(readFileSync(md, "utf8")).length;
}

/** One line for an older message: name, size, and how many parts the agent can ask for. */
export function earlierFileSummary(rows: { id: number; name: string; size: number; path: string; status?: string }[]): string {
  return rows.map((r) => `${r.name}, ${formatSize(r.size)}, ${partsPhrase(r.status ?? "", partsOnDisk(r))}`).join("; ");
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
  return which + formatPart(readFileSync(md, "utf8"), part);
}
