import { describe, it, expect } from "vitest";
import { anonymizeCases, scanCases, type CaseLike } from "../src/dataFactory/anonymize.ts";
import type { SensitiveTerms } from "../src/dataFactory/sensitive.ts";

const terms: SensitiveTerms = { people: ["Matti*"], terms: ["Orca"] };
const mk = (over: Partial<CaseLike> & { id: string }): CaseLike => ({ input: "", tags: [], meta: {}, ...over });

describe("scanCases", () => {
  const cases = [
    mk({ id: "c1", input: "Mail anna@example.com about Orca", expected: "Matti called +358 40 123 4567" }),
    mk({ id: "c2", input: "ANNA@example.com again, Mattia too", tags: ["pw password=hunter2"], meta: { who: "Matti", n: 358401234567 } }),
  ];

  it("gives one finding per value with counts and examples", () => {
    const findings = scanCases(cases, terms);
    const email = findings.find((f) => f.kind === "email");
    expect(email).toMatchObject({ placeholder: "Email_1", count: 2, caseCount: 2 });
    expect(email?.examples).toHaveLength(2);
    expect(email?.examples.every((e) => e.length <= 80)).toBe(true);
    expect(findings.map((f) => f.placeholder)).toEqual(["Email_1", "Term_1", "Person_1", "Phone_1", "Secret_1"]);
  });

  it("gives all forms of a star entry one placeholder, and a phone with other spacing the same one", () => {
    const findings = scanCases(cases, terms);
    const person = findings.find((f) => f.kind === "person");
    expect(person?.count).toBe(3);
    const phone = findings.filter((f) => f.kind === "phone");
    expect(phone).toHaveLength(1);
    expect(phone[0].count).toBe(1); // the number inside meta is not a "+" number
  });

  it("scans meta values and numbers but not keys", () => {
    const f = scanCases([mk({ id: "a", meta: { "a@example.com": { deep: ["b@example.com", 5] } } })], terms);
    expect(f.map((x) => x.value)).toEqual(["b@example.com"]);
  });

  it("skips a placeholder number that already occurs in the data", () => {
    const f = scanCases([mk({ id: "a", input: "Email_1 and a@example.com" })], terms);
    expect(f[0].placeholder).toBe("Email_2");
  });

  it("has a short stable key", () => {
    const a = scanCases(cases, terms)[0].key;
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(scanCases(cases, terms)[0].key).toBe(a);
  });
});

describe("anonymizeCases", () => {
  const cases = [
    mk({ id: "anna@example.com", input: "Mail anna@example.com about Orca and Matti", expected: "IP 10.0.0.1" }),
    mk({ id: "b", input: "again anna@example.com", tags: ["x@example.com"], meta: { n: 7, p: "call +358 40 123 4567" } }),
    mk({ id: "c", input: "nothing here" }),
  ];

  it("replaces every match consistently without changing the input", () => {
    const snapshot = JSON.stringify(cases);
    const r = anonymizeCases(cases, terms);
    expect(JSON.stringify(cases)).toBe(snapshot);
    expect(r.cases[0]).toMatchObject({
      id: "Email_1",
      input: "Mail Email_1 about Term_1 and Person_1",
      expected: "IP IP_1",
    });
    expect(r.cases[1]).toMatchObject({ input: "again Email_1", tags: ["Email_2"], meta: { n: 7, p: "call Phone_1" } });
    expect(r.cases[2]).toEqual(cases[2]);
    expect(r.cases[2]).not.toBe(cases[2]);
    expect(r.changed).toEqual([0, 1]);
    expect(r.counts).toEqual({ email: 4, term: 1, person: 1, ip: 1, phone: 1 });
  });

  it("turns a replaced number into a string", () => {
    const r = anonymizeCases([mk({ id: "a", meta: { n: 5551234567, m: 1 } })], { people: [], terms: ["555123*"] });
    expect(r.cases[0].meta).toEqual({ n: "Term_1", m: 1 });
  });

  it("leaves a disabled key alone and does not renumber the others", () => {
    const all = scanCases(cases, terms);
    const orca = all.find((f) => f.kind === "term");
    const ip = all.find((f) => f.kind === "ip");
    const r = anonymizeCases(cases, terms, { disabledKeys: [orca?.key ?? ""] });
    expect(r.cases[0].input).toBe("Mail Email_1 about Orca and Person_1");
    expect(r.cases[0].expected).toBe(`IP ${ip?.placeholder}`);
    expect(r.counts.term).toBeUndefined();
  });

  it("leaves a disabled kind alone", () => {
    const r = anonymizeCases(cases, terms, { disabledKinds: ["email"] });
    expect(r.cases[0].id).toBe("anna@example.com");
    expect(r.cases[0].input).toBe("Mail anna@example.com about Term_1 and Person_1");
  });

  it("makes ids unique when two become equal", () => {
    const dup = [mk({ id: "a@example.com" }), mk({ id: "A@example.com" }), mk({ id: "a@example.com" })];
    const r = anonymizeCases(dup, terms);
    expect(r.cases.map((c) => c.id)).toEqual(["Email_1", "Email_1-2", "Email_1-3"]);
  });

  it("finds nothing new when run again on its own output", () => {
    const first = anonymizeCases(cases, terms);
    const second = anonymizeCases(first.cases, terms);
    expect(second.changed).toEqual([]);
    expect(second.counts).toEqual({});
    expect(scanCases(first.cases, terms)).toEqual([]);
  });
});
