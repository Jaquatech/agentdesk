import { getSettings, type DB } from "./db.ts";
import { earlierFileSummary } from "./attachmentMarkdown.ts";
import { parseRules } from "./attachmentRules.ts";

/** One non-event message, oldest-first once the window is applied. `files` is a size-and-parts line; the latest user message's bytes are loaded separately. */
export type ChatTurn = { id: number; role: string; content: string; files: string | null };

/** The last `limit` messages of a chat, oldest first. Event lines (status) are not part of the conversation the model sees. */
export function recentTurns(db: DB, chatId: number, limit: number): ChatTurn[] {
  const turns = (db.prepare(`SELECT id, role, content FROM messages
    WHERE chat_id = ? AND role != 'event' ORDER BY id DESC LIMIT ?`)
    .all(chatId, limit) as { id: number; role: string; content: string }[]).reverse();
  if (!turns.length) return [];
  const ids = turns.map((t) => t.id);
  const files = db.prepare(`SELECT id, message_id, name, size, path, status, image_note FROM attachments
    WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`)
    .all(...ids) as { id: number; message_id: number; name: string; size: number; path: string; status: string; image_note: string }[];
  const byMessage = new Map<number, typeof files>();
  for (const f of files) {
    const list = byMessage.get(f.message_id) ?? [];
    list.push(f);
    byMessage.set(f.message_id, list);
  }
  const rules = parseRules(getSettings(db).attachment_rules);
  return turns.map((t) => {
    const line = earlierFileSummary(byMessage.get(t.id) ?? [], rules);
    return { ...t, files: line || null };
  });
}

/** Deliberate journal notes kept in a prompt. Roll-up rows are counted separately so they cannot push these out. */
export const JOURNAL_NOTE_LIMIT = 40;
/** Automatic roll-up notes kept in a prompt. */
export const JOURNAL_ROLLUP_LIMIT = 10;
/** After this many failed roll-ups the chat stops trying. */
export const ROLLUP_ATTEMPTS = 3;

export type JournalLine = { id: number; text: string; created_at: string; kind: string };

export type RollupState = {
  history_rolled_to: number;
  history_rollup_failures: number;
  history_rollup_anchor: number;
};

/**
 * Journal lines for a prompt, oldest first: the newest deliberate notes, plus at most the newest roll-ups.
 * Roll-ups are `kind = 'rollup'`. Every other kind is a note someone chose to keep.
 */
export function journalLines(db: DB, projectId: number): JournalLine[] {
  const notes = db.prepare(`SELECT id, text, created_at, kind FROM project_journal
    WHERE project_id = ? AND kind != 'rollup' ORDER BY id DESC LIMIT ?`)
    .all(projectId, JOURNAL_NOTE_LIMIT) as JournalLine[];
  const rollups = db.prepare(`SELECT id, text, created_at, kind FROM project_journal
    WHERE project_id = ? AND kind = 'rollup' ORDER BY id DESC LIMIT ?`)
    .all(projectId, JOURNAL_ROLLUP_LIMIT) as JournalLine[];
  return [...notes, ...rollups].sort((a, b) => a.id - b.id);
}

export function formatJournal(rows: { text: string; created_at: string }[]): string {
  return rows.map((j) => `- ${j.created_at.slice(0, 10)}: ${j.text}`).join("\n") || "empty";
}

/** How many messages must leave the window after a failed roll-up before another try. */
export function rollupRetryGap(window: number): number {
  return Math.max(1, Math.floor(window / 2));
}

/** Id of the first message still inside the window, or 0 when nothing has dropped. */
export function rollupWindowEdge(ids: number[], window: number): number {
  if (ids.length <= window) return 0;
  return ids[ids.length - window];
}

/**
 * Messages that have fallen out of the window and are not covered by `history_rolled_to` yet.
 * The first time anything has dropped, the whole dropped part is due (one call). After that, another
 * call waits until a full window has dropped, so a new message does not summarize again.
 * A failed attempt waits until half a window has slid past `history_rollup_anchor`. Three failures and nothing is due again.
 */
export function messagesDueForRollup(
  messages: { id: number; role: string; content: string }[],
  window: number,
  state: RollupState,
): { id: number; role: string; content: string }[] {
  if (state.history_rollup_failures >= ROLLUP_ATTEMPTS) return [];
  const all = messages.filter((m) => m.role !== "event");
  if (all.length <= window) return [];
  const edge = rollupWindowEdge(all.map((m) => m.id), window);
  const dropped = all.filter((m) => m.id < edge && m.id > state.history_rolled_to);
  if (!dropped.length) return [];
  if (state.history_rolled_to !== 0 && dropped.length < window) return [];
  if (state.history_rollup_failures > 0 && state.history_rollup_anchor > 0) {
    const slid = all.filter((m) => m.id >= state.history_rollup_anchor && m.id < edge).length;
    if (slid < rollupRetryGap(window)) return [];
  }
  return dropped;
}

export function rollupBatch(db: DB, chatId: number, window: number): { id: number; role: string; content: string }[] {
  const state = db.prepare("SELECT history_rolled_to, history_rollup_failures, history_rollup_anchor FROM chats WHERE id = ?")
    .get(chatId) as RollupState | undefined;
  if (!state) return [];
  const all = db.prepare("SELECT id, role, content FROM messages WHERE chat_id = ? ORDER BY id")
    .all(chatId) as { id: number; role: string; content: string }[];
  return messagesDueForRollup(all, window, state);
}

export function rollupAnchor(db: DB, chatId: number, window: number): number {
  const ids = (db.prepare("SELECT id FROM messages WHERE chat_id = ? AND role != 'event' ORDER BY id").all(chatId) as { id: number }[])
    .map((m) => m.id);
  return rollupWindowEdge(ids, window);
}

export function recordRollupFailure(db: DB, chatId: number, anchor: number) {
  db.prepare("UPDATE chats SET history_rollup_failures = history_rollup_failures + 1, history_rollup_anchor = ? WHERE id = ?")
    .run(anchor, chatId);
}

export function recordRollupSuccess(db: DB, chatId: number, rolledTo: number) {
  db.prepare("UPDATE chats SET history_rolled_to = ?, history_rollup_failures = 0, history_rollup_anchor = 0 WHERE id = ?")
    .run(rolledTo, chatId);
}

/** Keep a roll-up prompt bounded when a long stretch drops at once (a window change, or an old chat). */
export function clipRollup<T extends { content: string }>(messages: T[], maxChars = 12_000): T[] {
  const out: T[] = [];
  let used = 0;
  for (const m of messages) {
    const content = m.content.slice(0, 400);
    if (out.length && used + content.length > maxChars) break;
    out.push({ ...m, content });
    used += content.length;
  }
  return out;
}

export const ROLLUP_MARKER = "# Summarize dropped chat messages";

export function rollupPrompt(messages: { role: string; content: string }[]): string {
  const body = messages.map((m) => `## ${m.role === "user" ? "User" : "Assistant"}\n${m.content}`).join("\n\n");
  return `${ROLLUP_MARKER}
These messages fell out of the history window and will not be sent again. Write exactly three short lines a later chat can use: decisions, names, and outcomes. No tasks, no greeting.

${body}`;
}
