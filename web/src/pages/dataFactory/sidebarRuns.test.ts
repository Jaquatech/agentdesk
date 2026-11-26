import { describe, expect, it } from "vitest";
import { caseLabel } from "./caseLabel.ts";
import { localTime } from "./localTime.ts";
import { latestRuns } from "./sidebarRuns.ts";

describe("latestRuns", () => {
  const rows = (statuses: string[]) => statuses.map((status, id) => ({ id, status }));
  it("takes the first 5 and says whether any is running", () => {
    const r = latestRuns(rows(["done", "done", "done", "done", "done", "running"]));
    expect(r.shown).toHaveLength(5);
    expect(r.running).toBe(false);
    expect(latestRuns(rows(["done", "running"])).running).toBe(true);
    expect(latestRuns([]).shown).toEqual([]);
  });
});

describe("localTime", () => {
  it("formats ISO and database times", () => {
    expect(localTime("2026-11-26T13:27:45.095Z")).not.toBe("2026-11-26T13:27:45.095Z");
    expect(localTime("2026-11-26 13:27:45")).not.toBe("2026-11-26 13:27:45");
    expect(localTime("2026-11-26T13:27:45.095Z")).not.toContain("Invalid");
  });
  it("returns other text unchanged", () => {
    expect(localTime("not a date")).toBe("not a date");
  });
});

describe("caseLabel", () => {
  it("drops the generated prefix only", () => {
    expect(caseLabel("case-3")).toBe("Case 3");
    expect(caseLabel("q3")).toBe("Case q3");
    expect(caseLabel("case-a")).toBe("Case case-a");
  });
});
