import { describe, expect, it } from "vitest";
import { FIELD_INFO, KIND_INFO, KIND_ORDER, sameRules, withRuleValue, type AttachmentRules } from "./attachmentRules.ts";

const rules: AttachmentRules = {
  text: { enabled: true, partChars: 20000 },
  csv: { enabled: true, partChars: 20000 },
  xlsx: { enabled: true, partChars: 20000, maxRows: 200, maxCols: 20 },
  docx: { enabled: true, partChars: 20000 },
  pdf: { enabled: true, partChars: 20000 },
  image: { enabled: true, maxMb: 5 },
};

describe("withRuleValue", () => {
  it("changes one field and leaves the rest equal", () => {
    const next = withRuleValue(rules, "xlsx", "maxRows", 50);
    expect(next.xlsx.maxRows).toBe(50);
    expect(next.xlsx.maxCols).toBe(20);
    expect(next.xlsx.partChars).toBe(20000);
    expect(next.xlsx.enabled).toBe(true);
    for (const kind of KIND_ORDER.filter((k) => k !== "xlsx")) expect(next[kind]).toEqual(rules[kind]);
    expect(rules.xlsx.maxRows).toBe(200);
  });

  it("sets the enabled flag", () => {
    const next = withRuleValue(rules, "pdf", "enabled", false);
    expect(next.pdf.enabled).toBe(false);
    expect(rules.pdf.enabled).toBe(true);
  });
});

describe("sameRules", () => {
  it("is true for an equal copy and false after a change", () => {
    expect(sameRules(rules, structuredClone(rules))).toBe(true);
    expect(sameRules(withRuleValue(rules, "image", "maxMb", 3), rules)).toBe(false);
  });
});

describe("labels", () => {
  it("has info for every kind and field", () => {
    expect(KIND_ORDER).toHaveLength(6);
    for (const kind of KIND_ORDER) {
      expect(KIND_INFO[kind].label).not.toBe("");
      expect(KIND_INFO[kind].files).not.toBe("");
      expect(KIND_INFO[kind].enabledLabel).not.toBe("");
    }
    for (const field of ["partChars", "maxRows", "maxCols", "maxMb"] as const) {
      expect(FIELD_INFO[field].label).not.toBe("");
      expect(FIELD_INFO[field].hint).not.toBe("");
    }
  });
});
