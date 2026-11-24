import { describe, expect, it } from "vitest";
import { nextName } from "./datasetName.ts";

describe("nextName", () => {
  it("takes the file name when the user has not typed a name", () => {
    expect(nextName(false, "", "orders.v2.csv")).toBe("orders.v2");
  });

  it("keeps a typed name when a file is picked", () => {
    expect(nextName(true, "my name", "orders.csv")).toBe("my name");
  });

  it("renames to the second file after a first pick, so the second pick applies", () => {
    const afterA = nextName(false, "", "a.jsonl");
    expect(nextName(false, afterA, "b.jsonl")).toBe("b");
  });
});
