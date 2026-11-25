import { describe, expect, it } from "vitest";
import { canStart, clip, compareLine, estimateRange, formatUsd, progressPercent, statusLabel } from "./runs.ts";

describe("runs helpers", () => {
  it("formatUsd", () => {
    expect(formatUsd(null)).toBe("-");
    expect(formatUsd(undefined)).toBe("-");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00123)).toBe("$0.0012");
    expect(formatUsd(0.034)).toBe("$0.03");
    expect(formatUsd(12)).toBe("$12.00");
  });

  it("estimateRange", () => {
    expect(estimateRange(0, 0)).toBe("Free");
    expect(estimateRange(0.0301, 0.0304)).toBe("$0.03");
    expect(estimateRange(0.02, 0.05)).toBe("$0.02 - $0.05");
    expect(estimateRange(0, 0.05)).toBe("$0 - $0.05");
  });

  it("progressPercent", () => {
    expect(progressPercent(1, 0)).toBe(0);
    expect(progressPercent(0, 10)).toBe(0);
    expect(progressPercent(5, 10)).toBe(50);
    expect(progressPercent(12, 10)).toBe(100);
  });

  it("statusLabel", () => {
    expect(["planned", "running", "done", "stopped", "failed", "interrupted"].map(statusLabel))
      .toEqual(["Planned", "Running", "Done", "Stopped", "Failed", "Interrupted"]);
    expect(statusLabel("odd")).toBe("odd");
  });

  it("canStart and clip", () => {
    const ok = { missing: [], needs_cap: false, over_cap: false };
    expect(canStart(null, false)).toBe(false);
    expect(canStart(ok, false)).toBe(true);
    expect(canStart({ ...ok, missing: ["m"] }, true)).toBe(false);
    expect(canStart({ ...ok, needs_cap: true }, true)).toBe(false);
    expect(canStart({ ...ok, over_cap: true }, false)).toBe(false);
    expect(canStart({ ...ok, over_cap: true }, true)).toBe(true);
    expect(clip("abc", 5)).toEqual({ text: "abc", cut: false });
    expect(clip("abcdef", 5)).toEqual({ text: "abcde…", cut: true });
  });

  it("compareLine", () => {
    expect(compareLine(0.02, 0.05, 0.03)).toBe("Estimated $0.02 - $0.05, actual $0.03.");
    expect(compareLine(0.02, 0.05, 0.09)).toContain("above the high estimate");
    expect(compareLine(0, 0, 0.01)).toContain("The estimate was $0");
    expect(compareLine(0, 0, 0)).toBe("Estimated Free, actual $0.");
  });
});
