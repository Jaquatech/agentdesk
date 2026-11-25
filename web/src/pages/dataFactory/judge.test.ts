import { describe, expect, it } from "vitest";
import { averageText, hasEnded, judgeableRuns, overallAverage, passRateText, scoreLabel, verdictFrom, verdictLabel, verdictQuery } from "./judge.ts";

describe("judge helpers", () => {
  it("knows which runs have ended", () => {
    for (const s of ["done", "stopped", "failed", "interrupted"]) expect(hasEnded(s)).toBe(true);
    for (const s of ["planned", "running", ""]) expect(hasEnded(s)).toBe(false);
  });
  it("keeps ended runs with answers, in order", () => {
    const runs = [
      { id: 1, status: "done", answers: 3 }, { id: 2, status: "running", answers: 3 },
      { id: 3, status: "failed", answers: 0 }, { id: 4, status: "stopped", answers: 1 },
    ];
    expect(judgeableRuns(runs).map((r) => r.id)).toEqual([1, 4]);
    expect(judgeableRuns([])).toEqual([]);
  });
  it("writes the average with one decimal and a dash when nothing was judged", () => {
    expect(averageText(4.25, 4)).toBe("4.3");
    expect(averageText(5, 2)).toBe("5.0");
    expect(averageText(null, 0)).toBe("-");
    expect(averageText(3, 0)).toBe("-");
    expect(averageText(null, 2)).toBe("-");
  });
  it("writes the pass rate as a percent", () => {
    expect(passRateText(0.5, 2)).toBe("50%");
    expect(passRateText(2 / 3, 3)).toBe("67%");
    expect(passRateText(null, 0)).toBe("-");
    expect(passRateText(1, 0)).toBe("-");
  });
  it("weights the overall average by judged answers", () => {
    expect(overallAverage([{ judged: 1, avg_score: 5, pass_rate: 1, errors: 0 }, { judged: 3, avg_score: 3, pass_rate: 0, errors: 1 }])).toBe("3.5");
    expect(overallAverage([])).toBe("-");
    expect(overallAverage([{ judged: 0, avg_score: null, pass_rate: null, errors: 2 }])).toBe("-");
  });
  it("labels scores", () => {
    expect(scoreLabel(4)).toBe("4 of 5");
    expect(scoreLabel(null)).toBe("-");
    expect(scoreLabel(undefined)).toBe("-");
  });
  it("labels verdicts in words", () => {
    expect(verdictLabel("ok", 1)).toBe("Pass");
    expect(verdictLabel("ok", 0)).toBe("Fail");
    expect(verdictLabel("error", null)).toBe("Error");
  });
  it("turns the verdict filter into a query part", () => {
    expect(verdictQuery("pass")).toBe("&verdict=pass");
    expect(verdictQuery("fail")).toBe("&verdict=fail");
    expect(verdictQuery("all")).toBe("");
    expect(verdictQuery("x")).toBe("");
    expect(verdictFrom("pass")).toBe("pass");
    expect(verdictFrom("")).toBe("all");
  });
});
