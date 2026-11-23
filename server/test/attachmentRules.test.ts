import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";
import { DEFAULT_RULES, FIELD_RANGE, RULE_FIELDS, parseRules, ruleKindFor, type AttachmentRules } from "../src/attachmentRules.ts";
import { convertUpload, markdownPath, sheetsToMarkdown, PART_CHARS, SHEET_COL_CAP, SHEET_ROW_CAP } from "../src/attachmentMarkdown.ts";
import { loadForPrompt, type AttachmentRow } from "../src/attachments.ts";

const clone = (r: AttachmentRules): AttachmentRules => JSON.parse(JSON.stringify(r));

describe("attachment rules", () => {
  it("gives the defaults for missing or invalid input, as a new object", () => {
    expect(parseRules(undefined)).toEqual(DEFAULT_RULES);
    expect(parseRules("not json")).toEqual(DEFAULT_RULES);
    expect(parseRules(undefined)).not.toBe(DEFAULT_RULES);
    expect(parseRules(DEFAULT_RULES)).not.toBe(DEFAULT_RULES);
  });

  it("keeps today's limits as the defaults", () => {
    expect(DEFAULT_RULES.xlsx.maxRows).toBe(SHEET_ROW_CAP);
    expect(DEFAULT_RULES.xlsx.maxCols).toBe(SHEET_COL_CAP);
    expect(DEFAULT_RULES.text.partChars).toBe(PART_CHARS);
    expect(DEFAULT_RULES.image.maxMb).toBe(5);
  });

  it("clamps and rounds numbers to the allowed range", () => {
    const r = parseRules({ xlsx: { maxRows: 99999, maxCols: 1, partChars: 2500.4 } });
    expect(r.xlsx.maxRows).toBe(5000);
    expect(r.xlsx.maxCols).toBe(3);
    expect(r.xlsx.partChars).toBe(2500);
  });

  it("reads enabled as a boolean or a string, and falls back on bad values", () => {
    const r = parseRules({ pdf: { enabled: "false" } });
    expect(r.pdf.enabled).toBe(false);
    expect(r.pdf.partChars).toBe(20000);
    expect(parseRules({ pdf: { enabled: "maybe" } }).pdf.enabled).toBe(true);
    expect(parseRules({ csv: { partChars: "abc" } }).csv.partChars).toBe(20000);
  });

  it("drops unknown kinds and fields that do not belong to a kind", () => {
    const r = parseRules({ video: {}, image: { maxMb: 3, maxRows: 40 } });
    expect(Object.keys(r).sort()).toEqual(["csv", "docx", "image", "pdf", "text", "xlsx"]);
    expect(r.image).toEqual({ enabled: true, maxMb: 3 });
    expect(RULE_FIELDS.image).toEqual(["maxMb"]);
    expect(FIELD_RANGE.maxMb.max).toBe(15);
  });

  it("parses a JSON string the same as an object", () => {
    expect(parseRules(JSON.stringify({ image: { maxMb: 9 } }))).toEqual(parseRules({ image: { maxMb: 9 } }));
  });

  it("maps text kinds to rule kinds", () => {
    expect(ruleKindFor("copy")).toBe("text");
    expect(ruleKindFor("tsv")).toBe("csv");
    expect(ruleKindFor("pdf")).toBe("pdf");
    expect(ruleKindFor("")).toBeNull();
  });

  it("does not convert a type whose rule is switched off", async () => {
    const rules = clone(DEFAULT_RULES);
    rules.csv.enabled = false;
    expect(await convertUpload("a.csv", "text/csv", Buffer.from("a,b\n1,2\n"), rules)).toBeNull();
    expect((await convertUpload("a.csv", "text/csv", Buffer.from("a,b\n1,2\n")))?.status).toBe("converted");
  });

  it("uses the given caps for sheets and says what was cut", () => {
    const rows = [["a", "b", "c", "d"], ["1", "2", "3", "4"], ["1", "2", "3", "4"], ["1", "2", "3", "4"], ["1", "2", "3", "4"]];
    const out = sheetsToMarkdown([{ name: "S", rows }], { maxRows: 3, maxCols: 2 });
    expect(out.status).toBe("truncated");
    expect(out.markdown).toContain("Cut 2 rows and 2 columns.");
    const dataLines = (out.markdown ?? "").split("\n").filter((l) => l.startsWith("| ") && !l.includes("---"));
    expect(dataLines).toHaveLength(3);
    expect(dataLines[0]).toBe("| a | b |");
  });

  describe("loadForPrompt and the API", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ad-rules-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    const row = (over: Partial<AttachmentRow> & { id: number; name: string; mime: string; path: string }): AttachmentRow =>
      ({ chat_id: 1, message_id: 1, size: 1, created_at: "", ...over });

    it("splits a text copy by the text part size", () => {
      const path = join(dir, "1-notes.txt");
      writeFileSync(path, "original");
      writeFileSync(markdownPath({ id: 1, path }), "x".repeat(5000));
      const rules = clone(DEFAULT_RULES);
      rules.text.partChars = 2000;
      const out = loadForPrompt([row({ id: 1, name: "notes.txt", mime: "text/plain", path, status: "converted" })], { rules });
      expect(out.texts[0].parts).toBe(3);
    });

    it("names images without sending them when images are off", () => {
      const path = join(dir, "1-a.png");
      writeFileSync(path, Buffer.from([137, 80, 78, 71]));
      const rules = clone(DEFAULT_RULES);
      rules.image.enabled = false;
      const out = loadForPrompt([row({ id: 1, name: "a.png", mime: "image/png", path, size: 4 })], { rules, vision: true });
      expect(out.images).toHaveLength(0);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0]).toContain("images are turned off");
    });

    it("skips an image larger than the image size setting", () => {
      const path = join(dir, "1-big.png");
      writeFileSync(path, Buffer.alloc(2 * 1024 * 1024));
      const rules = clone(DEFAULT_RULES);
      rules.image.maxMb = 1;
      const out = loadForPrompt([row({ id: 1, name: "big.png", mime: "image/png", path, size: 2 * 1024 * 1024 })], { rules, vision: true });
      expect(out.images).toHaveLength(0);
      expect(out.notes[0].text).toBe("big.png not sent: larger than 1 MB");
    });

    let ctx: Awaited<ReturnType<typeof buildApp>>;
    let cookie: string;
    const data = () => mkdtempSync(join(tmpdir(), "ad-rules-api-"));
    beforeEach(async () => {
      ctx = await buildApp({ dataDir: data() });
      const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
      cookie = String(setup.headers["set-cookie"]).split(";")[0];
    });
    afterEach(async () => { await ctx.app.close(); });

    it("returns the defaults, then stores a change", async () => {
      const get = await ctx.app.inject({ method: "GET", url: "/api/attachment-rules", headers: { cookie, host: "localhost" } });
      const before = get.json();
      expect(before.rules).toEqual(before.defaults);
      expect(before.fields).toEqual(RULE_FIELDS);
      expect(before.ranges).toEqual(FIELD_RANGE);

      const put = await ctx.app.inject({ method: "PUT", url: "/api/attachment-rules", headers: { cookie, host: "localhost" }, payload: { rules: { xlsx: { maxRows: 50 } } } });
      expect(put.json().rules.xlsx.maxRows).toBe(50);

      const again = await ctx.app.inject({ method: "GET", url: "/api/attachment-rules", headers: { cookie, host: "localhost" } });
      expect(again.json().rules).toEqual(put.json().rules);
    });
  });
});
