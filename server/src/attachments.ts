import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { DB } from "./db.ts";

/**
 * Files the user pastes or drops into a chat (screenshots, logs, specs). Stored on this machine under
 * data/attachments/<chat id>/; the database keeps the name and type. "Clear" in Settings deletes the files.
 */

export const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Images up to this size go to the model (Anthropic's per-image limit is 5 MB). */
const MAX_IMAGE_TO_MODEL = 5 * 1024 * 1024;
const MAX_TEXT_TO_MODEL = 200 * 1024;
const TEXT_EXT = new Set([".txt", ".md", ".json", ".xml", ".xsl", ".xslt", ".csv", ".tsv", ".log", ".yaml", ".yml", ".ini", ".toml",
  ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".cs", ".java", ".sql", ".ps1", ".sh", ".bat", ".cmd", ".config", ".env.example"]);

export type AttachmentRow = {
  id: number; chat_id: number; message_id: number | null; name: string; mime: string; size: number; path: string; created_at: string;
  /** Why this file was not sent, shown under the message. Empty when it was sent. */
  note?: string;
};

export type PromptAttachments = {
  /** Images the model can look at. */
  images: { name: string; mime: string; base64: string }[];
  /** Text files, inlined into the prompt. */
  texts: { name: string; content: string }[];
  /** Everything else (and files too big): named, not sent. */
  skipped: string[];
  /** Absolute paths of every file that is still on disk (the Claude CLI may allow that folder). */
  paths: string[];
  /** Paths of files that were actually sent (images and text). Skipped files stay out of this list. */
  readPaths: string[];
  /** Short note per file that was not sent, for the chat under that message. */
  notes: { id: number; text: string }[];
};

/** Told to the model whenever a file was named instead of sent, so the reply says so instead of guessing. */
export const UNSENT_REPLY = "Say in your reply which of these were not sent and why. Do not guess their contents.";

/** The "# Attached by the user" block the API loop adds to the prompt. Images are listed; the caller attaches the bytes. */
export function attachmentPrompt(att: PromptAttachments): string {
  if (!att.texts.length && !att.images.length && !att.skipped.length) return "";
  const lines = [
    ...att.images.map((i) => `- ${i.name} (image, shown below)`),
    ...att.skipped.map((s) => `- ${s}`),
  ];
  const caution = att.skipped.length ? `\n${UNSENT_REPLY}` : "";
  const texts = att.texts.map((t) => `\n\n## ${t.name}\n\`\`\`\n${t.content}\n\`\`\``).join("");
  return `\n\n# Attached by the user\n${lines.join("\n")}${caution}${texts}`;
}

export function attachmentDir(dataDir: string) {
  return join(dataDir, "attachments");
}

const isText = (a: { mime: string; name: string }) =>
  a.mime.startsWith("text/") || a.mime === "application/json" || a.mime === "application/xml" || TEXT_EXT.has(extname(a.name).toLowerCase());

const kindOf = (a: { mime: string; name: string }) => {
  const mime = a.mime.toLowerCase();
  const ext = extname(a.name).toLowerCase();
  if (mime === "application/pdf" || ext === ".pdf") return "PDF";
  if (mime.includes("wordprocessing") || mime.includes("msword") || ext === ".doc" || ext === ".docx") return "Word";
  if (mime.includes("spreadsheet") || mime.includes("ms-excel") || ext === ".xls" || ext === ".xlsx") return "Excel";
  return "";
};

/** Short line under the chat message. The model gets the longer `skipped` string. */
function unsentNote(a: AttachmentRow, why: "missing" | "vision" | "image-size" | "text-size" | "type"): string {
  if (why === "missing") return `${a.name} not sent: removed from the cache`;
  if (why === "vision") return `${extname(a.name).replace(/^\./, "").toUpperCase() || "Image"} not sent: this model cannot read images`;
  if (why === "image-size") return `${a.name} not sent: larger than 5 MB`;
  if (why === "text-size") return `${a.name} not sent: larger than 200 KB`;
  const kind = kindOf(a);
  return kind ? `${a.name} not sent: ${kind} files are named only` : `${a.name} not sent: this file type is named only`;
}

/** `vision: false` = the model cannot read images: they are named, not sent. */
export function loadForPrompt(rows: AttachmentRow[], opts: { vision?: boolean | null; model?: string } = {}): PromptAttachments {
  const out: PromptAttachments = { images: [], texts: [], skipped: [], paths: [], readPaths: [], notes: [] };
  const skip = (a: AttachmentRow, line: string, why: "missing" | "vision" | "image-size" | "text-size" | "type") => {
    out.skipped.push(line);
    out.notes.push({ id: a.id, text: unsentNote(a, why) });
  };
  for (const a of rows) {
    if (!existsSync(a.path)) { skip(a, `${a.name} (removed from the cache)`, "missing"); continue; }
    out.paths.push(a.path);
    if (IMAGE_TYPES.has(a.mime) && opts.vision === false) {
      skip(a, `${a.name} (image: ${opts.model || "this model"} cannot read images, so it was not sent)`, "vision");
    } else if (IMAGE_TYPES.has(a.mime) && a.size <= MAX_IMAGE_TO_MODEL) {
      out.images.push({ name: a.name, mime: a.mime, base64: readFileSync(a.path).toString("base64") });
      out.readPaths.push(a.path);
    } else if (isText(a) && a.size <= MAX_TEXT_TO_MODEL) {
      out.texts.push({ name: a.name, content: readFileSync(a.path, "utf8") });
      out.readPaths.push(a.path);
    } else if (IMAGE_TYPES.has(a.mime)) {
      skip(a, `${a.name} (${a.mime || "file"}, ${Math.round(a.size / 1024)} KB: not sent to the model)`, "image-size");
    } else if (isText(a)) {
      skip(a, `${a.name} (${a.mime || "file"}, ${Math.round(a.size / 1024)} KB: not sent to the model)`, "text-size");
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
    db.prepare("UPDATE attachments SET path = ? WHERE id = ?").run(path, id);
    return { id, name, mime, size: body.length };
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
    if (a) { rmSync(a.path, { force: true }); db.prepare("DELETE FROM attachments WHERE id = ?").run(a.id); }
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
