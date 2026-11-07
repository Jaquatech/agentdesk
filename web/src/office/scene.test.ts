import { describe, it, expect } from "vitest";
import { deskPos, W } from "./scene.ts";
import { lookFor } from "./palette.ts";

describe("office layout", () => {
  it("places desks inside the room without overlap", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const d = deskPos(i);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + 40).toBeLessThan(W);
      seen.add(`${d.x},${d.y}`);
    }
    expect(seen.size).toBe(12);
  });
  it("gives each name a stable look and keeps saved choices", () => {
    expect(lookFor("Aino", {})).toEqual(lookFor("Aino", {}));
    expect(lookFor("Aino", { shirt: "#000000" }).shirt).toBe("#000000");
  });
});
