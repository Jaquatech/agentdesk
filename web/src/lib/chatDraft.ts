/** Unsent chat text and attachments, one draft per chat.
 *  The page session keeps the draft in memory, including image preview URLs.
 *  `sessionStorage` mirrors the text and the uploaded attachment ids so a refresh keeps them.
 *  Not `localStorage`: a draft can hold private text and should disappear when the tab closes.
 *  Preview URLs are left out of the stored copy; they stop working after a refresh. The file bytes stay on the server.
 */

export type DraftFile = {
  key: string;
  name: string;
  mime: string;
  size: number;
  preview?: string;
  id?: number;
  error?: string;
};

export type ChatDraft = { text: string; files: DraftFile[] };

const memory = new Map<number, ChatDraft>();

const storageKey = (chatId: number) => `agentdesk.chatDraft.${chatId}`;
const unfinished = "The upload did not finish. Attach the file again.";

const empty = (): ChatDraft => ({ text: "", files: [] });

function session(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

type StoredFile = { key: string; name: string; mime: string; size: number; id?: number; error?: string };

function asFile(raw: unknown): DraftFile | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<StoredFile>;
  if (typeof f.key !== "string" || typeof f.name !== "string") return null;
  const file: DraftFile = {
    key: f.key,
    name: f.name,
    mime: typeof f.mime === "string" ? f.mime : "",
    size: typeof f.size === "number" && Number.isFinite(f.size) ? f.size : 0,
  };
  if (typeof f.id === "number" && Number.isFinite(f.id)) file.id = f.id;
  if (typeof f.error === "string" && f.error) file.error = f.error;
  else if (file.id === undefined) file.error = unfinished;
  return file;
}

function readStored(chatId: number): ChatDraft {
  try {
    const raw = session()?.getItem(storageKey(chatId));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as { text?: unknown; files?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const files = Array.isArray(parsed.files) ? parsed.files.flatMap((item) => {
      const file = asFile(item);
      return file ? [file] : [];
    }) : [];
    return { text, files };
  } catch {
    return empty();
  }
}

function writeStored(chatId: number, draft: ChatDraft) {
  try {
    const store = session();
    if (!store) return;
    const key = storageKey(chatId);
    if (!draft.text && draft.files.length === 0) {
      store.removeItem(key);
      return;
    }
    const files: StoredFile[] = draft.files.map(({ key: fileKey, name, mime, size, id, error }) => {
      const stored: StoredFile = { key: fileKey, name, mime, size };
      if (id !== undefined) stored.id = id;
      if (error) stored.error = error;
      return stored;
    });
    store.setItem(key, JSON.stringify({ text: draft.text, files }));
  } catch {
    // Quota or a blocked store: the in-memory draft still covers this tab.
  }
}

function clone(draft: ChatDraft): ChatDraft {
  return { text: draft.text, files: draft.files.map((file) => ({ ...file })) };
}

export function getDraft(chatId: number): ChatDraft {
  const hit = memory.get(chatId);
  if (hit) return clone(hit);
  const stored = readStored(chatId);
  if (stored.text || stored.files.length) memory.set(chatId, stored);
  return clone(stored);
}

export function setDraft(chatId: number, draft: ChatDraft) {
  if (!draft.text && draft.files.length === 0) {
    clearDraft(chatId);
    return;
  }
  memory.set(chatId, clone(draft));
  writeStored(chatId, draft);
}

export function clearDraft(chatId: number) {
  memory.delete(chatId);
  try { session()?.removeItem(storageKey(chatId)); } catch { /* the memory entry is already gone */ }
}

/** Drops every in-memory draft. Tests use this between cases; sessionStorage is left alone. */
export function resetChatDrafts() {
  memory.clear();
}

/** Merge lists the way chat live events do. Messages are only added; tasks are replaced by id. */
export function mergeById<T extends { id: number }>(prev: readonly T[], incoming: readonly T[], replace: boolean): T[] {
  const out = [...prev];
  for (const item of incoming) {
    const at = out.findIndex((have) => have.id === item.id);
    if (at < 0) out.push(item);
    else if (replace) out[at] = item;
  }
  return out.sort((a, b) => a.id - b.id);
}
