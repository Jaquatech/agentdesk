import { describe, expect, it } from "vitest";
import { fenced, percent, problems, reportUrl, seconds, unvoted, type ReportCase, type RunReport } from "./report.ts";

const base: ReportCase = {
  run_model_id: 1, provider_name: "p", model: "m", case_key: "a", tags: [], input: "", expected: null, answer: "",
  status: "ok", error: "", tokens_in: 0, tokens_out: 0, cost_usd: null, ms: null, judge: null, vote: null, agrees: null,
};
const judged = (pass: boolean) => ({ status: "ok" as const, score: pass ? 1 : 0, pass, reason: "", error: "" });

describe("report helpers", () => {
  it("fences with a longer run of backticks", () => {
    expect(fenced("a")).toBe("```markdown\na\n```");
    expect(fenced("x ```` y").startsWith("`````")).toBe(true);
    expect(fenced("x ```` y").endsWith("\n`````")).toBe(true);
  });
  it("formats percent and seconds", () => {
    expect(percent(0.5)).toBe("50%");
    expect(percent(null)).toBe("-");
    expect(seconds(1234)).toBe("1.2 s");
    expect(seconds(null)).toBe("-");
  });
  it("sorts problems", () => {
    const failed = { ...base, case_key: "f", judge: judged(false) };
    const error = { ...base, case_key: "e", status: "error" as const };
    const disagree = { ...base, case_key: "d", judge: judged(true), vote: { verdict: "bad" as const, note: "" }, agrees: false };
    const both = { ...base, case_key: "b", judge: judged(false), vote: { verdict: "good" as const, note: "" }, agrees: false };
    const p = problems([failed, error, disagree, both]);
    expect(p.failed.map((c) => c.case_key)).toEqual(["f", "b"]);
    expect(p.errors.map((c) => c.case_key)).toEqual(["e"]);
    expect(p.disagreements.map((c) => c.case_key)).toEqual(["d", "b"]);
  });
  it("counts unvoted ok answers", () => {
    const report = { cases: [base, { ...base, vote: { verdict: "good", note: "" } }, { ...base, status: "error" }] } as unknown as RunReport;
    expect(unvoted(report)).toBe(1);
  });
  it("builds report urls", () => {
    expect(reportUrl(3, "csv", null, false)).toBe("/api/eval-runs/3/report.csv?all=0");
    expect(reportUrl(3, "csv", 7, false)).toBe("/api/eval-runs/3/report.csv?judge=7&all=0");
    expect(reportUrl(3, "md", 7, true)).toBe("/api/eval-runs/3/report.md?judge=7&all=1");
  });
});
