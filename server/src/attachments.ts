import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { getSettings, type DB } from "./db.ts";
import { convertUpload, markdownPath, partSizeFor, splitParts } from "./attachmentMarkdown.ts";
import { DEFAULT_RULES, parseRules, type AttachmentRules } from "./attachmentRules.ts";

/**
 * Files the user pastes or drops into a chat (screenshots, logs, specs). Stored on this machine under
 * data/attachments/<chat id>/; the database keeps the name and type. A text file also gets a Markdown
 * copy at <id>.md, which "Clear" in Settings and deleting the chat remove with the original.
 */

export const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type AttachmentRow = {
  id: number; chat_id: number; message_id: number | null; name: string; mime: string; size: number; path: string; created_at: string;
  /** Why this file was not sent, shown under the message. Empty when it was sent. */
  note?: string;
  /** converted, truncated, failed: reason, needs_ocr, or empty when nothing was copied. */
  status?: string;
};

export type PromptAttachments = {
  /** Images the model can look at. */
  images: { name: string; mime: string; base64: string }[];
  /** First part of a Markdown copy. */
  texts: { name: string; content: string; part: number; parts: number }[];
  /** Everything else: named, not sent. */
  skipped: string[];
  /** Absolute paths of every file that is still on disk (the Claude CLI may allow that folder). */
  paths: string[];
  /** Paths of files that were actually sent (images and Markdown copies). Skipped files stay out of this list. */
  readPaths: string[];
  /** Short note per file that was not sent, for the chat under that message. */
  notes: { id: number; text: string }[];
};

/** Told to the model whenever a file was named instead of sent, so the reply says so instead of guessing. */
export const UNSENT_REPLY = "Say in your reply which of these were not sent and why. Do not guess their contents.";

/** The "# Attached by the user" block the API loop adds to the prompt. Images are listed; the caller attaches the bytes. */
function partNotice(t: { name: string; part: number; parts: number }): string {
  if (t.parts <= 1) return "";
  const left = t.parts - t.part;
  return `part ${t.part} of ${t.parts}. ${left} ${left === 1 ? "part remains" : "parts remain"}. Call read_attachment with name "${t.name}" and part ${t.part + 1} for the next. Do not guess the rest.\n\n`;
}

export function attachmentPrompt(att: PromptAttachments): string {
  if (!att.texts.length && !att.images.length && !att.skipped.length) return "";
  const lines = [
    ...att.images.map((i) => `- ${i.name} (image, shown below)`),
    ...att.texts.map((t) => `- ${t.name} (Markdown, part ${t.part} of ${t.parts})`),
    ...att.skipped.map((s) => `- ${s}`),
  ];
  const imageLine = att.images.length ? `\n${IMAGE_NOTE_LINE}` : "";
  const caution = att.skipped.length ? `\n${UNSENT_REPLY}` : "";
  const texts = att.texts.map((t) => `\n\n## ${t.name}\n${partNotice(t)}${t.content}`).join("");
  return `\n\n# Attached by the user\n${lines.join("\n")}${imageLine}${caution}${texts}`;
}

/** Asked of the agent that is shown an image, so later messages can use its note instead of the image. */
export const IMAGE_NOTE_LINE ="Put one short line per image in `image_notes` (name and what matters in it). It is stored, so later messages can use it without the image.";
const MAX_IMAGE_NOTES = 10;
const MAX_IMAGE_NOTE_CHARS = 300;

/**
 * Stores the `image_notes` an agent wrote for the images it was shown. Each note goes to the newest image of that
 * name in this chat that has no note yet; an existing note is never overwritten. Returns the message ids updated.
 */
export function storeImageNotes(db: DB, chatId: number, raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const updated = new Set<number>();
  const find = db.prepare(
    "UPDATE attachments SET image_note = ? WHERE id = (SELECT id FROM attachments WHERE chat_id = ? AND name = ? AND mime LIKE 'image/%' AND image_note = '' ORDER BY id DESC LIMIT 1) RETURNING message_id",
  );
  for (const entry of raw.slice(0, MAX_IMAGE_NOTES)) {
    if (!entry || typeof entry !== "object") continue;
    const { name, note } = entry as { name?: unknown; note?: unknown };
    if (typeof name !== "string" || typeof note !== "string") continue;
    const text = note.trim().slice(0, MAX_IMAGE_NOTE_CHARS);
    if (!text) continue;
    const rows = find.all(text, chatId, name) as { message_id: number | null }[];
    for (const r of rows) if (r.message_id != null) updated.add(r.message_id);
  }
  return [...updated];
}

export function attachmentDir(dataDir: string) {
  return join(dataDir, "attachments");
}

const kindOf = (a: { mime: string; name: string }) => {
  const mime = a.mime.toLowerCase();
  const ext = extname(a.name).toLowerCase();
  if (mime === "application/pdf" || ext === ".pdf") return "PDF";
  if (mime.includes("wordprocessing") || mime.includes("msword") || ext === ".doc" || ext === ".docx") return "Word";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel") || ext === ".xls" || ext === ".xlsx") return "Excel";
  return "";
};

/** Short line under the chat message. The model gets the longer `skipped` string. */
function unsentNote(a: AttachmentRow, why: "missing" | "vision" | "image-size" | "failed" | "ocr" | "type", maxMb = 5): string {
  if (why === "missing") return `${a.name} not sent: removed from the cache`;
  if (why === "vision") return `${extname(a.name).replace(/^\./, "").toUpperCase() || "Image"} not sent: this model cannot read images`;
  if (why === "image-size") return `${a.name} not sent: larger than ${maxMb} MB`;
  if (why === "failed") return `${a.name} not sent: ${(a.status ?? "").replace(/^failed:\s*/, "") || "could not be read"}`;
  if (why === "ocr") return `${a.name} not sent: no text layer`;
  const kind = kindOf(a);
  return kind ? `${a.name} not sent: ${kind} files are named only` : `${a.name} not sent: this file type is named only`;
}

/** `vision: false` = the model cannot read images: they are named, not sent. `rules` default to the built-in limits. */
export function loadForPrompt(rows: AttachmentRow[], opts: { vision?: boolean | null; model?: string; rules?: AttachmentRules } = {}): PromptAttachments {
  const rules = opts.rules ?? DEFAULT_RULES;
  const maxMb = rules.image.maxMb ?? 5;
  const out: PromptAttachments = { images: [], texts: [], skipped: [], paths: [], readPaths: [], notes: [] };
  const skip = (a: AttachmentRow, line: string, why: "missing" | "vision" | "image-size" | "failed" | "ocr" | "type") => {
    out.skipped.push(line);
    out.notes.push({ id: a.id, text: unsentNote(a, why, maxMb) });
  };
  for (const a of rows) {
    if (!existsSync(a.path)) { skip(a, `${a.name} (removed from the cache)`, "missing"); continue; }
    out.paths.push(a.path);
    const status = a.status ?? "";
    const md = markdownPath(a);
    if (status.startsWith("failed:")) {
      skip(a, `${a.name} (${status.replace(/^failed:\s*/, "")}: not sent to the model)`, "failed");
    } else if (status === "needs_ocr") {
      skip(a, `${a.name} (no text layer: not sent to the model)`, "ocr");
    } else if ((status === "converted" || status === "truncated") && existsSync(md)) {
      const text = readFileSync(md, "utf8");
      const parts = splitParts(text, partSizeFor(a.name, rules));
      out.texts.push({ name: a.name, content: parts[0] ?? "", part: 1, parts: parts.length });
      out.readPaths.push(md);
    } else if (IMAGE_TYPES.has(a.mime) && !rules.image.enabled) {
      skip(a, `${a.name} (images are turned off in Attachment handling: not sent to the model)`, "type");
    } else if (IMAGE_TYPES.has(a.mime) && opts.vision === false) {
      skip(a, `${a.name} (image: ${opts.model || "this model"} cannot read images, so it was not sent)`, "vision");
    } else if (IMAGE_TYPES.has(a.mime) && a.size <= maxMb * 1024 * 1024) {
      out.images.push({ name: a.name, mime: a.mime, base64: readFileSync(a.path).toString("base64") });
      out.readPaths.push(a.path);
    } else if (IMAGE_TYPES.has(a.mime)) {
      skip(a, `${a.name} (${a.mime || "file"}, ${Math.round(a.size / 1024)} KB: not sent to the model)`, "image-size");
    } else {
      skip(a, `${a.name} (${a.mime || "file"}, ${Math.round(a.size / 1024)} KB: not sent to the model)`, "type");
    }
  }
  return out;
}

export function deleteChatFiles(dataDir: string, chatId: number) {
  rmSync(join(attachmentDir(dataDir), String(chatId)), { recursive: true, force: true });
}

function folderStats(dir: string) {
  let files = 0, bytes = 0;
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full); else { files++; bytes += st.size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

const safeName = (name: string) =>
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  (name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").slice(-120) || "file";

export function registerAttachments(app: FastifyInstance, db: DB, dataDir: string) {
  const root = attachmentDir(dataDir);

  // Raw upload: the file is the body; name and type travel in the query string.
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));

  app.post("/api/chats/:id/attachments", async (req, reply) => {
    const chatId = Number((req.params as Record<string, string>).id);
    if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(chatId)) return reply.code(404).send({ error: "Chat not found" });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: "Empty file" });
    const q = req.query as Record<string, string>;
    const name = safeName(String(q.name ?? "file"));
    const mime = String(q.type || "application/octet-stream").slice(0, 100);
    const dir = join(root, String(chatId));
    mkdirSync(dir, { recursive: true });
    const info = db.prepare("INSERT INTO attachments (chat_id, name, mime, size, path) VALUES (?, ?, ?, ?, '')").run(chatId, name, mime, body.length);
    const id = Number(info.lastInsertRowid);
    const path = join(dir, `${id}-${name}`);
    writeFileSync(path, body);
    // The original stays as uploaded. A copy is written beside it; a failure is recorded and the message can still be sent.
    const conv = await convertUpload(name, mime, body, parseRules(getSettings(db).attachment_rules));
    const status = conv?.status ?? "";
    if (conv?.markdown != null) writeFileSync(markdownPath({ id, path }), conv.markdown, "utf8");
    db.prepare("UPDATE attachments SET path = ?, status = ? WHERE id = ?").run(path, status, id);
    return { id, name, mime, size: body.length, status };
  });

  app.get("/api/attachments/:id", async (req, reply) => {
    const a = db.prepare("SELECT * FROM attachments WHERE id = ?").get(Number((req.params as Record<string, string>).id)) as AttachmentRow | undefined;
    if (!a || !existsSync(a.path) || !resolve(a.path).startsWith(resolve(root) + sep)) return reply.code(404).send({ error: "Not in the cache any more" });
    // Images and plain text show in the browser; anything else downloads. Never served as HTML.
    const inline = IMAGE_TYPES.has(a.mime) || a.mime === "text/plain";
    reply.header("content-type", inline ? a.mime : "application/octet-stream");
    reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
    reply.header("x-content-type-options", "nosniff");
    reply.header("cache-control", "private, max-age=86400");
    return reply.send(readFileSync(a.path));
  });

  app.delete("/api/attachments/:id", async (req) => {
    const a = db.prepare("SELECT * FROM attachments WHERE id = ? AND message_id IS NULL").get(Number((req.params as Record<string, string>).id)) as AttachmentRow | undefined;
    if (a) { rmSync(a.path, { force: true }); rmSync(join(dirname(a.path), `${a.id}.md`), { force: true }); db.prepare("DELETE FROM attachments WHERE id = ?").run(a.id); }
    return { ok: true };
  });

  // Settings: the cache folder, how much is in it, and clearing it.
  app.get("/api/attachments-cache", async () => ({ folder: root, ...folderStats(root) }));
  app.delete("/api/attachments-cache", async () => {
    const before = folderStats(root);
    rmSync(root, { recursive: true, force: true });
    // Messages keep their text; the attachment rows stay so the chat can say "removed from the cache".
    db.prepare("DELETE FROM attachments WHERE message_id IS NULL").run();
    return { removed: before.files, bytes: before.bytes };
  });
}
