import { describe, expect, it } from "vitest";
import { JUDGE_EXAMPLES } from "./judgeExamples.ts";

describe("judge examples", () => {
  it("has unique ids, a name and a when line", () => {
    expect(new Set(JUDGE_EXAMPLES.map((e) => e.id)).size).toBe(JUDGE_EXAMPLES.length);
    for (const e of JUDGE_EXAMPLES) {
      expect(e.id).not.toBe("");
      expect(e.name).not.toBe("");
      expect(e.when).not.toBe("");
    }
  });

  it("keeps each text short and defines the scores and pass", () => {
    for (const e of JUDGE_EXAMPLES) {
      expect(e.text.length).toBeLessThanOrEqual(700);
      for (const n of [1, 2, 3, 4, 5]) expect(e.text).toContain(String(n));
      expect(e.text.toLowerCase()).toContain("pass");
    }
  });

  it("starts with the current default", () => {
    // Mirrors DEFAULT_RUBRIC in server/src/dataFactory/judge.ts; the web cannot import server code.
    expect(JUDGE_EXAMPLES[0].text.startsWith("You are a strict grader.")).toBe(true);
  });
});
