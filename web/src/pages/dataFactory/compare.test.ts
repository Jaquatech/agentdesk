import { describe, expect, it } from "vitest";
import { changeWord, compareUrl, countsText, filterCases, orderSides, type Change, type PairCase } from "./compare.ts";

const side = { status: "ok" as const, answer: "", score: null, pass: null, reason: "", vote: null };
const mk = (change: Change): PairCase => ({ case_key: change, change, input: "", expected: null, a: side, b: side });

describe("compare helpers", () => {
  it("puts the older run first unless swapped", () => {
    expect(orderSides(5, 2, false)).toEqual({ a: 2, b: 5 });
    expect(orderSides(2, 5, false)).toEqual({ a: 2, b: 5 });
    expect(orderSides(5, 2, true)).toEqual({ a: 5, b: 2 });
  });
  it("words the counts", () => {
    expect(countsText({ broke: 2, fixed: 1, same_pass: 4, same_fail: 1, unjudged: 0 }))
      .toBe("2 broke, 1 fixed, 4 passed in both, 1 failed in both, 0 not judged");
  });
  it("words every change", () => {
    expect(changeWord("broke")).toBe("Broke");
    expect(changeWord("fixed")).toBe("Fixed");
    expect(changeWord("same_pass")).toBe("Passed both");
    expect(changeWord("same_fail")).toBe("Failed both");
    expect(changeWord("unjudged")).toBe("Not judged");
  });
  it("filters cases", () => {
    const all = (["broke", "fixed", "same_pass", "same_fail", "unjudged"] as Change[]).map(mk);
    expect(filterCases(all, "changed").map((c) => c.change)).toEqual(["broke", "fixed"]);
    expect(filterCases(all, "broke").map((c) => c.change)).toEqual(["broke"]);
    expect(filterCases(all, "fixed").map((c) => c.change)).toEqual(["fixed"]);
    expect(filterCases(all, "all")).toHaveLength(5);
  });
  it("builds compare urls", () => {
    expect(compareUrl("csv", 2, 5, null, 7)).toBe("/api/eval-compare.csv?a=2&b=5&judge_b=7");
    expect(compareUrl("md", 2, 5, 1, 7)).toBe("/api/eval-compare.md?a=2&b=5&judge_a=1&judge_b=7");
  });
});
