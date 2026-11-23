import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDraft, getDraft, mergeById, resetChatDrafts, setDraft, type DraftFile } from "./chatDraft.ts";

const file = (extra: Partial<DraftFile> = {}): DraftFile => ({
  key: "k1", name: "shot.png", mime: "image/png", size: 12, preview: "blob:preview", id: 7, ...extra,
});

let backing: Map<string, string>;

function installStorage(overrides: Partial<Storage> = {}) {
  backing = new Map();
  const store: Storage = {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value); },
    removeItem: (key) => { backing.delete(key); },
    clear: () => { backing.clear(); },
    key: (index) => [...backing.keys()][index] ?? null,
    get length() { return backing.size; },
    ...overrides,
  };
  vi.stubGlobal("sessionStorage", store);
}

describe("chat drafts", () => {
  afterEach(() => {
    resetChatDrafts();
    vi.unstubAllGlobals();
    installStorage();
  });

  it("keeps a separate draft per chat", () => {
    installStorage();
    setDraft(1, { text: "one", files: [] });
    setDraft(2, { text: "two", files: [file()] });
    expect(getDraft(1)).toEqual({ text: "one", files: [] });
    expect(getDraft(2).text).toBe("two");
    expect(getDraft(2).files).toEqual([file()]);
    expect(getDraft(3)).toEqual({ text: "", files: [] });
    expect(backing.has("agentdesk.chatDraft.1")).toBe(true);
    expect(backing.has("agentdesk.chatDraft.2")).toBe(true);
  });

  it("survives a remount and keeps the preview url in memory", () => {
    installStorage();
    setDraft(1, { text: "keep me", files: [file()] });
    // A remounted composer calls getDraft again. The module still holds the draft, preview included.
    expect(getDraft(1)).toEqual({ text: "keep me", files: [file()] });
    const stored = JSON.parse(backing.get("agentdesk.chatDraft.1") ?? "{}") as { files: DraftFile[] };
    expect(stored.files[0].preview).toBeUndefined();
    expect(stored.files[0].id).toBe(7);
  });

  it("keeps the text and uploaded attachment ids when the module loads again", async () => {
    installStorage();
    setDraft(1, { text: "keep me", files: [file()] });
    vi.resetModules();
    const fresh = await import("./chatDraft.ts");
    const draft = fresh.getDraft(1);
    expect(draft.text).toBe("keep me");
    expect(draft.files.map((item) => item.id)).toEqual([7]);
    expect(draft.files[0].preview).toBeUndefined();
    fresh.resetChatDrafts();
  });

  it("falls back when sessionStorage throws", () => {
    installStorage({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(() => setDraft(1, { text: "secret", files: [file()] })).not.toThrow();
    expect(getDraft(1).text).toBe("secret");
    expect(getDraft(1).files[0].id).toBe(7);
    expect(() => clearDraft(1)).not.toThrow();
    expect(getDraft(1)).toEqual({ text: "", files: [] });
  });

  it("clears the draft on send, and clearing the box by hand clears the stored text", () => {
    installStorage();
    setDraft(1, { text: "bye", files: [file()] });
    clearDraft(1);
    expect(getDraft(1)).toEqual({ text: "", files: [] });
    expect(backing.has("agentdesk.chatDraft.1")).toBe(false);

    setDraft(1, { text: "half", files: [file()] });
    setDraft(1, { text: "", files: [file()] });
    expect(getDraft(1).text).toBe("");
    expect(getDraft(1).files).toHaveLength(1);
    expect(JSON.parse(backing.get("agentdesk.chatDraft.1") ?? "{}").text).toBe("");

    setDraft(1, { text: "", files: [] });
    expect(backing.has("agentdesk.chatDraft.1")).toBe(false);
  });

  it("marks an attachment that never finished uploading when it is read back", async () => {
    installStorage();
    setDraft(4, { text: "pic", files: [{ key: "k", name: "a.png", mime: "image/png", size: 4, preview: "blob:x" }] });
    vi.resetModules();
    const fresh = await import("./chatDraft.ts");
    expect(fresh.getDraft(4).files[0].error).toMatch(/upload did not finish/i);
    expect(fresh.getDraft(4).files[0].id).toBeUndefined();
    fresh.resetChatDrafts();
  });
});

describe("mergeById", () => {
  it("adds messages that are new and leaves ones already shown", () => {
    const prev = [{ id: 1, content: "a" }, { id: 3, content: "local" }];
    const incoming = [{ id: 1, content: "server" }, { id: 2, content: "b" }];
    expect(mergeById(prev, incoming, false)).toEqual([
      { id: 1, content: "a" },
      { id: 2, content: "b" },
      { id: 3, content: "local" },
    ]);
  });

  it("replaces a task with the same id and appends a new one", () => {
    const prev = [{ id: 1, status: "building" }, { id: 2, status: "queued" }];
    const incoming = [{ id: 2, status: "merged" }, { id: 4, status: "queued" }];
    expect(mergeById(prev, incoming, true)).toEqual([
      { id: 1, status: "building" },
      { id: 2, status: "merged" },
      { id: 4, status: "queued" },
    ]);
  });
});
