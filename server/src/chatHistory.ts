import type { DB } from "./db.ts";

/** One non-event message, oldest-first once the window is applied. `files` names attachments; the latest user message's bytes are loaded separately. */
export type ChatTurn = { id: number; role: string; content: string; files: string | null };

/** The last `limit` messages of a chat, oldest first. Event lines (status) are not part of the conversation the model sees. */
export function recentTurns(db: DB, chatId: number, limit: number): ChatTurn[] {
  return (db.prepare(`SELECT m.id, m.role, m.content,
      (SELECT GROUP_CONCAT(a.name, ', ') FROM attachments a WHERE a.message_id = m.id) AS files
    FROM messages m WHERE m.chat_id = ? AND m.role != 'event' ORDER BY m.id DESC LIMIT ?`)
    .all(chatId, limit) as ChatTurn[]).reverse();
}

export function journalLines(db: DB, projectId: number): { text: string; created_at: string }[] {
  return (db.prepare(`SELECT j.text, j.created_at FROM project_journal j WHERE j.project_id = ? ORDER BY j.id DESC LIMIT 40`)
    .all(projectId) as { text: string; created_at: string }[]).reverse();
}

export function formatJournal(rows: { text: string; created_at: string }[]): string {
  return rows.map((j) => `- ${j.created_at.slice(0, 10)}: ${j.text}`).join("\n") || "empty";
}

/**
 * Messages that have fallen out of the window and are not covered by `chats.history_rolled_to` yet.
 * The first time anything has dropped, the whole dropped part is due (one call). After that, another
 * call waits until a full window has dropped, so a new message does not summarize again.
 */
export function rollupBatch(db: DB, chatId: number, window: number): { id: number; role: string; content: string }[] {
  const rolled = (db.prepare("SELECT history_rolled_to FROM chats WHERE id = ?").get(chatId) as { history_rolled_to: number } | undefined)?.history_rolled_to ?? 0;
  const all = db.prepare("SELECT id, role, content FROM messages WHERE chat_id = ? AND role != 'event' ORDER BY id")
    .all(chatId) as { id: number; role: string; content: string }[];
  if (all.length <= window) return [];
  const keptFrom = all[all.length - window].id;
  const dropped = all.filter((m) => m.id < keptFrom && m.id > rolled);
  if (!dropped.length) return [];
  if (rolled !== 0 && dropped.length < window) return [];
  return dropped;
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
