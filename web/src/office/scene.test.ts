import { describe, it, expect } from "vitest";
import { DEFAULT_FEATURES, buildLayout, deskExit, groupAgents, routeBetween, spotExit, type Features, type Layout, type Pt } from "./layout.ts";
import { glassSegments } from "./props.ts";
import { sortItems } from "./scene.ts";
import { lookFor } from "./palette.ts";
import { initials } from "./logo.ts";

const agents = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, role: (i === 0 ? "planner" : i === n - 1 ? "reviewer" : "worker") as "planner" | "worker" | "reviewer" }));

describe("office layout", () => {
  it("gives every agent its own desk inside the room, without overlap", () => {
    for (const n of [1, 3, 6, 9, 14]) {
      const l = buildLayout(agents(n), [], DEFAULT_FEATURES);
      const seen = new Set<string>();
      for (const d of l.desks) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x + 2).toBeLessThanOrEqual(l.zoneW);
        expect(d.y + 1).toBeLessThan(l.rows);
        seen.add(`${d.x},${d.y}`);
      }
      expect(seen.size).toBe(l.desks.length);
      for (let i = 1; i <= n; i++) expect(l.desks.filter((d) => d.agentId === i)).toHaveLength(1);
    }
  });

  it("keeps spots in the lounge and their approach paths clear of the desk zone", () => {
    const l = buildLayout(agents(6), [], DEFAULT_FEATURES);
    expect(l.spots.length).toBeGreaterThan(8);
    for (const s of l.spots) {
      expect(s.x).toBeGreaterThanOrEqual(l.lx);
      expect(s.x).toBeLessThan(l.cols);
      expect(s.y).toBeLessThan(l.rows);
      for (const p of s.via) expect(p.x).toBeGreaterThanOrEqual(l.corridorX);
    }
  });

  it("only offers the break spots whose feature is on", () => {
    const off: Features = { ...DEFAULT_FEATURES, arcade: false, slots: false, coffee: false, sofa: false };
    const kinds = new Set(buildLayout(agents(4), [], off).spots.map((s) => s.kind));
    expect([...kinds]).toEqual(["chat"]);
    const on = new Set(buildLayout(agents(4), [], DEFAULT_FEATURES).spots.map((s) => s.kind));
    expect(on).toEqual(new Set(["arcade", "slots", "coffee", "sofa", "chat"]));
  });

  it("builds a glass room per team when there are two or more", () => {
    const ag = agents(7);
    const teams = [{ id: 1, name: "Web", members: [1, 2, 3] }, { id: 2, name: "Data", members: [4, 5] }];
    const groups = groupAgents(ag, teams, true);
    expect(groups.map((g) => g.name)).toEqual(["Web", "Data", "Open space"]);
    expect(groups.map((g) => g.glass)).toEqual([true, true, false]);
    const l = buildLayout(ag, teams, DEFAULT_FEATURES);
    expect(l.blocks.filter((b) => b.glass)).toHaveLength(2);
    // blocks never overlap
    for (const a of l.blocks) for (const b of l.blocks) if (a !== b) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart).toBe(true);
    }
    // no rooms: one open office
    expect(buildLayout(ag, teams, { ...DEFAULT_FEATURES, rooms: false }).blocks).toHaveLength(1);
    // a single team is not worth a glass wall
    expect(groupAgents(ag, [{ id: 1, name: "All", members: ag.map((a) => a.id) }], true)).toHaveLength(1);
  });

  it("routes from a desk to a lounge spot through the corridor", () => {
    const l = buildLayout(agents(6), [], DEFAULT_FEATURES);
    const d = l.desks[2];
    const spot = l.spots[0];
    const path = routeBetween(deskExit(l, d), spotExit(l, spot));
    expect(path[path.length - 1]).toEqual({ x: spot.x, y: spot.y });
    expect(path.some((p) => p.x === l.corridorX)).toBe(true);
  });
});

function rects(l: Layout) {
  const f = l.features, L = l.lounge;
  const r: { x: number; y: number; w: number; d: number; n: string }[] = [];
  for (const d of l.desks) r.push({ x: d.x, y: d.y, w: 2, d: 1, n: "desk" });
  if (f.coffee) r.push({ ...L.counter, n: "counter" });
  if (f.sofa) r.push({ ...L.sofa, n: "sofa" });
  if (f.table) r.push({ ...L.table, n: "table" });
  if (f.arcade) r.push({ ...L.arcade, n: "arcade" });
  if (f.slots) r.push({ ...L.slots, n: "slots" });
  if (f.decor) r.push({ ...L.shelf, n: "shelf" });
  return r;
}

/** Points along a polyline every 0.1 tile. */
function sample(pts: Pt[]) {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

describe("walking routes", () => {
  const ag = agents(11);
  const teams = [{ id: 1, name: "Web", members: [1, 2, 3, 4] }, { id: 2, name: "Data", members: [5, 6, 7, 8] }];
  for (const [name, feats, t] of [["open office", DEFAULT_FEATURES, []], ["team rooms", DEFAULT_FEATURES, teams], ["bare", { ...DEFAULT_FEATURES, arcade: false, slots: false, sofa: false, table: false, coffee: false, decor: false }, teams]] as const) {
    it(`never walk through furniture or glass (${name})`, () => {
      const l = buildLayout(ag, t as never, feats);
      const blocked = rects(l);
      const glass = l.blocks.filter((b) => b.glass).flatMap((b) => glassSegments(b));
      for (const d of l.desks) for (const s of l.spots) {
        for (const path of [routeBetween(deskExit(l, d), spotExit(l, s)), routeBetween(spotExit(l, s), deskExit(l, d))]) {
          const full = sample([path === undefined ? d.seat : (path.length ? (path[0] as Pt) : d.seat), ...path]);
          for (const p of full) {
            for (const r of blocked) {
              if (s.kind === "sofa" && r.n === "sofa") continue; // sitting down is the point
              // a seat sits just behind its own desk; the person itself is allowed to touch the desk edge
              const inside = p.x > r.x + 0.02 && p.x < r.x + r.w - 0.02 && p.y > r.y + 0.02 && p.y < r.y + r.d - 0.02;
              expect(inside, `${r.n} at ${p.x.toFixed(2)},${p.y.toFixed(2)} on the way to ${s.key}`).toBe(false);
            }
            expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(l.cols);
            expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(l.rows);
          }
          // glass: no step may cross a wall segment
          for (let i = 1; i < full.length; i++) for (const g of glass) {
            const horiz = g.y0 === g.y1;
            if (horiz) { const lo = Math.min(g.x0, g.x1), hi = Math.max(g.x0, g.x1); if (full[i].x > lo && full[i].x < hi && (full[i - 1].y - g.y0) * (full[i].y - g.y0) < 0) throw new Error(`crossed glass at ${g.x0},${g.y0}`); }
            else { const lo = Math.min(g.y0, g.y1), hi = Math.max(g.y0, g.y1); if (full[i].y > lo && full[i].y < hi && (full[i - 1].x - g.x0) * (full[i].x - g.x0) < 0) throw new Error(`crossed glass at ${g.x0},${g.y0}`); }
          }
        }
      }
    });
  }
});

describe("drawing order", () => {
  it("draws what is further from the camera first", () => {
    const behind = { x0: 0, x1: 2, y0: 0, y1: 1, n: "behind" };
    const front = { x0: 0, x1: 2, y0: 2, y1: 3, n: "front" };
    const side = { x0: 3, x1: 4, y0: 0, y1: 1, n: "side" };
    expect(sortItems([side, front, behind]).map((i) => i.n)).toEqual(["behind", "front", "side"]);
  });
});

describe("looks and logo", () => {
  it("gives each name a stable look and keeps saved choices", () => {
    expect(lookFor("Aino", {})).toEqual(lookFor("Aino", {}));
    expect(lookFor("Aino", { shirt: "#000000" }).shirt).toBe("#000000");
  });
  it("makes initials from the company name", () => {
    expect(initials("My Company")).toBe("MC");
    expect(initials("acme")).toBe("AC");
    expect(initials("  ")).toBe("?");
  });
});
