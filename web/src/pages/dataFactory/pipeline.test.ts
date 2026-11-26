import { describe, expect, it } from "vitest";
import { changedFields, countsLine, firstApprovedVersion, parseTermLines, requestBody, type CaseView, type Finding } from "./pipeline.ts";

const finding = (key: string, kind: Finding["kind"]): Finding => ({ key, kind, value: key, placeholder: "X_1", count: 1, caseCount: 1, examples: [] });
const view = (over: Partial<CaseView>): CaseView => ({ case_key: "a", input: "i", expected: null, tags: [], meta: {}, ...over });

describe("firstApprovedVersion", () => {
  it("takes the first approved one in the list", () => {
    const v = [{ id: 3, approved_at: null }, { id: 2, approved_at: "x" }, { id: 1, approved_at: "y" }];
    expect(firstApprovedVersion(v)?.id).toBe(2);
  });
  it("is null when none is approved", () => {
    expect(firstApprovedVersion([{ approved_at: null }])).toBeNull();
    expect(firstApprovedVersion([])).toBeNull();
  });
});

describe("requestBody", () => {
  const fs = [finding("a", "email"), finding("b", "email"), finding("c", "phone")];
  it("lists unticked findings and switched-off kinds", () => {
    expect(requestBody(fs, new Set(["b"]), new Set(["phone"]))).toEqual({ disabled_keys: ["b"], disabled_kinds: ["phone"] });
  });
  it("does not list a finding of a switched-off kind", () => {
    expect(requestBody(fs, new Set(["a", "c"]), new Set(["email"]))).toEqual({ disabled_keys: ["c"], disabled_kinds: ["email"] });
  });
  it("is empty when nothing is off", () => {
    expect(requestBody(fs, new Set(), new Set())).toEqual({ disabled_keys: [], disabled_kinds: [] });
  });
});

describe("parseTermLines", () => {
  it("trims, drops empty lines and duplicates", () => {
    expect(parseTermLines(" Matt* \r\n\n Anna\nMatt*\n  ")).toEqual(["Matt*", "Anna"]);
  });
  it("gives an empty list for empty text", () => {
    expect(parseTermLines("")).toEqual([]);
  });
});

describe("changedFields", () => {
  it("returns only the fields that differ", () => {
    const c = { case_key: "a", before: view({ input: "mail me@x.com", expected: "ok" }), after: view({ input: "mail Email_1", expected: "ok" }) };
    expect(changedFields(c)).toEqual([{ field: "input", before: "mail me@x.com", after: "mail Email_1" }]);
  });
  it("sees expected, tags and meta", () => {
    const c = {
      case_key: "a",
      before: view({ expected: "a@b.co", tags: ["x"], meta: { note: "n1" } }),
      after: view({ expected: "Email_1", tags: ["x"], meta: { note: "n2" } }),
    };
    expect(changedFields(c).map((f) => f.field)).toEqual(["expected", "note"]);
  });
  it("is empty when nothing differs", () => {
    expect(changedFields({ case_key: "a", before: view({}), after: view({}) })).toEqual([]);
  });
});

describe("countsLine", () => {
  it("names the kinds", () => {
    expect(countsLine({ email: 2, phone: 1, ip: 0 })).toBe("2 email addresses, 1 phone number");
  });
});
