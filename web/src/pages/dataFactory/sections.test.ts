import { describe, expect, it } from "vitest";
import { SECTIONS, sectionFromTab } from "./sections.ts";

describe("data factory sections", () => {
  it("defaults to datasets", () => {
    expect(sectionFromTab()).toBe("datasets");
    expect(sectionFromTab("")).toBe("datasets");
  });
  it("accepts every known id", () => {
    for (const s of SECTIONS) expect(sectionFromTab(s.id)).toBe(s.id);
  });
  it("falls back for an unknown id", () => {
    expect(sectionFromTab("nope")).toBe("datasets");
  });
  it("keeps the planned order", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["import", "datasets", "models", "judge", "runs", "review", "reports"]);
  });
});
