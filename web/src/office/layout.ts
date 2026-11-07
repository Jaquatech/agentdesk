import type { Role } from "../api.ts";
import { hashString } from "./palette.ts";

/**
 * Where everything stands. Pure data, so it can be tested without a canvas.
 * Grid units are tiles; x runs down-right, y runs down-left (see iso.ts).
 */

export type Features = {
  plants: boolean; coffee: boolean; sofa: boolean; table: boolean;
  arcade: boolean; slots: boolean; decor: boolean; rooms: boolean;
};

export const FEATURE_LABELS: { key: keyof Features; label: string; hint: string }[] = [
  { key: "rooms", label: "Team rooms", hint: "Each team gets its own glass room (needs two or more teams with members)" },
  { key: "plants", label: "Plants", hint: "Plants in the corners and in the team rooms" },
  { key: "coffee", label: "Coffee corner", hint: "A counter with a coffee machine on the back wall" },
  { key: "sofa", label: "Sofa and TV", hint: "A sofa facing a TV; the TV shows a game when someone sits there" },
  { key: "table", label: "Coffee table", hint: "A low table in front of the sofa" },
  { key: "arcade", label: "Arcade cabinet", hint: "An invaders-style game that idle agents play" },
  { key: "slots", label: "Slot machine", hint: "A slot machine that idle agents try their luck on" },
  { key: "decor", label: "Decorations", hint: "Posters, rug, lamps, clock and a bookshelf" },
];

export const DEFAULT_FEATURES: Features = {
  plants: true, coffee: true, sofa: true, table: true, arcade: true, slots: true, decor: true, rooms: true,
};

export function featuresFromSettings(s: Record<string, string>): Features {
  const f = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(f) as (keyof Features)[]) {
    const v = s[`office_${k}`];
    if (v !== undefined) f[k] = v !== "false";
  }
  return f;
}

export type TeamInfo = { id: number; name: string; members: number[] };
export type AgentRef = { id: number; role: Role };
export type Pt = { x: number; y: number };

export type Desk = { x: number; y: number; agentId: number | null; block: number; seat: Pt; aisleY: number };
export type Block = {
  id: number; name: string; x: number; y: number; w: number; h: number; glass: boolean; color: string;
  desks: Desk[]; corrX: number; laneY: number;
};

export type SpotKind = "sofa" | "coffee" | "arcade" | "slots" | "chat";
export type Spot = { key: string; kind: SpotKind; x: number; y: number; via: Pt[]; face: "front" | "back" };

export type Layout = {
  cols: number; rows: number; zoneW: number; lx: number; corridorX: number;
  blocks: Block[]; desks: Desk[]; spots: Spot[]; features: Features;
  /** Lounge furniture positions (only meaningful when the matching feature is on). */
  lounge: {
    counter: { x: number; y: number; w: number; d: number };
    tv: { x: number; w: number };
    table: { x: number; y: number; w: number; d: number };
    sofa: { x: number; y: number; w: number; d: number };
    arcade: { x: number; y: number; w: number; d: number };
    slots: { x: number; y: number; w: number; d: number };
    shelf: { x: number; y: number; w: number; d: number };
    rug: { x: number; y: number; w: number; d: number };
    plants: { x: number; y: number; big: boolean }[];
    lamp: Pt;
  };
};

export const TEAM_COLORS = ["#3f7fd0", "#d0573f", "#4f9a5a", "#c98b2e", "#8a5bc8", "#2f8f8a", "#c84f8a", "#5b6b7a"];
export const WALL_Z = 3.3;
const LOUNGE_W = 8;
const MAX_ROW_W = 17;

const roleRank = (r: Role) => (r === "planner" ? 0 : r === "worker" ? 1 : 2);

type Group = { id: number; name: string; glass: boolean; agents: AgentRef[] };

/** Rooms only when asked for and there is more than one group to separate. */
export function groupAgents(agents: AgentRef[], teams: TeamInfo[], rooms: boolean): Group[] {
  const sorted = [...agents].sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.id - b.id);
  if (!rooms) return [{ id: 0, name: "Office", glass: false, agents: sorted }];
  const taken = new Set<number>();
  const groups: Group[] = [];
  for (const t of teams) {
    const mine = sorted.filter((a) => t.members.includes(a.id) && !taken.has(a.id));
    mine.forEach((a) => taken.add(a.id));
    if (mine.length) groups.push({ id: t.id, name: t.name, glass: true, agents: mine });
  }
  const rest = sorted.filter((a) => !taken.has(a.id));
  if (groups.length < 2 && !(groups.length === 1 && rest.length)) return [{ id: 0, name: "Office", glass: false, agents: sorted }];
  if (rest.length) groups.push({ id: -1, name: "Open space", glass: false, agents: rest });
  return groups;
}

type Size = { g: Group; n: number; dcols: number; w: number; h: number };

/** Lays the blocks out left to right, wrapping at maxW; returns where each goes and how big the zone is. */
function flow(sizes: Size[], maxW: number) {
  let cx = 0, cy = 0, rowH = 0;
  const pos: { x: number; y: number; row: number }[] = [];
  let row = 0;
  for (const z of sizes) {
    if (cx > 0 && cx + z.w > maxW) { cy += rowH + 2; cx = 0; rowH = 0; row++; }
    pos.push({ x: cx, y: cy, row });
    cx += z.w + (z.g.glass ? 1 : 0);
    rowH = Math.max(rowH, z.h);
  }
  const zoneW = Math.max(...sizes.map((z, i) => pos[i].x + z.w));
  const zoneH = cy + rowH + 1.5;
  return { pos, zoneW, rows: Math.max(12, Math.ceil(zoneH)), rowsUsed: row + 1 };
}

export function buildLayout(agents: AgentRef[], teams: TeamInfo[], features: Features): Layout {
  const groups = groupAgents(agents, teams, features.rooms);
  const single = groups.length === 1;
  const sizes: Size[] = groups.map((g) => {
    const n = single ? Math.max(g.agents.length, 4) : Math.max(g.agents.length, 1);
    const dcols = single ? Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n)))) : Math.min(3, n);
    const drows = Math.ceil(n / dcols);
    return { g, n, dcols, w: 3 * dcols + 1, h: 1 + 3 * drows };
  });
  // The screen is wider than tall, so pick the wrap width that gives the smallest room (width + depth).
  let best = flow(sizes, MAX_ROW_W), bestScore = Infinity;
  for (const maxW of [8, 11, 14, 17, 20, 23, 26, 29, 33]) {
    const f = flow(sizes, maxW);
    const score = f.zoneW + 1 + LOUNGE_W + f.rows;
    if (score < bestScore - 0.01) { best = f; bestScore = score; }
  }
  const blocks: Block[] = [];
  const rows: Block[][] = [];
  sizes.forEach((z, i) => {
    const { x: cx, y: cy, row } = best.pos[i];
    const { g, n, dcols, w, h } = z;
    const b: Block = {
      id: g.id, name: g.name, x: cx, y: cy, w, h, glass: g.glass,
      color: TEAM_COLORS[hashString(g.name) % TEAM_COLORS.length], desks: [], corrX: cx + w - 0.5, laneY: 0,
    };
    for (let k = 0; k < n; k++) {
      const dx = cx + 1 + (k % dcols) * 3, dy = cy + 1 + Math.floor(k / dcols) * 3;
      b.desks.push({ x: dx, y: dy, agentId: g.agents[k]?.id ?? null, block: i, seat: { x: dx + 1, y: dy - 0.45 }, aisleY: dy + 1.5 });
    }
    blocks.push(b);
    (rows[row] ??= []).push(b);
  });
  for (const row of rows) {
    const top = Math.min(...row.map((b) => b.y)), maxH = Math.max(...row.map((b) => b.h));
    for (const b of row) b.laneY = top + maxH + 0.7;
  }

  const zoneW = Math.max(...blocks.map((b) => b.x + b.w));
  const L = zoneW + 1;
  const corridorX = zoneW + 0.5;
  const cols = L + LOUNGE_W;
  const nrows = best.rows;

  const lounge: Layout["lounge"] = {
    counter: { x: L, y: 0, w: 2, d: 0.9 },
    tv: { x: L + 2.7, w: 3 },
    table: { x: L + 3.4, y: 1.9, w: 1.6, d: 0.8 },
    sofa: { x: L + 2.9, y: 3.5, w: 3, d: 1 },
    arcade: { x: L + 5.1, y: 6.1, w: 0.8, d: 0.9 },
    slots: { x: L + 5.1, y: 8.0, w: 0.8, d: 0.9 },
    shelf: { x: L + 6.2, y: 0, w: 1.6, d: 0.55 },
    rug: { x: L + 2.2, y: 1.3, w: 4.4, d: 4.4 },
    plants: [{ x: L + 0.5, y: 4.9, big: true }, { x: L + 7.3, y: 1.1, big: true }, { x: L + 7.2, y: 10.6, big: false }],
    lamp: { x: L + 6.6, y: 3.4 },
  };

  const spots: Spot[] = [];
  const clamp = (y: number) => Math.min(y, nrows - 0.6);
  const lowY = clamp(10.4);
  if (features.arcade) spots.push({ key: "arcade", kind: "arcade", x: lounge.arcade.x + 1.55, y: lounge.arcade.y + 0.45, face: "back", via: [{ x: corridorX, y: lowY }, { x: lounge.arcade.x + 1.55, y: lowY }] });
  if (features.slots) spots.push({ key: "slots", kind: "slots", x: lounge.slots.x + 1.55, y: lounge.slots.y + 0.45, face: "back", via: [{ x: corridorX, y: lowY }, { x: lounge.slots.x + 1.55, y: lowY }] });
  if (features.coffee) {
    spots.push({ key: "coffee-1", kind: "coffee", x: L + 0.7, y: 1.5, face: "back", via: [{ x: corridorX, y: 2.7 }, { x: L + 0.7, y: 2.7 }] });
  }
  if (features.sofa) {
    for (let i = 0; i < 3; i++) {
      const sx = lounge.sofa.x + 0.5 + i;
      spots.push({ key: `sofa-${i + 1}`, kind: "sofa", x: sx, y: lounge.sofa.y + 0.5, face: "back", via: [{ x: corridorX, y: 5.5 }, { x: sx, y: 5.5 }] });
    }
  }
  if (features.coffee) {
    spots.push({ key: "coffee-2", kind: "coffee", x: L + 1.6, y: 1.5, face: "back", via: [{ x: corridorX, y: 2.7 }, { x: L + 1.6, y: 2.7 }] });
  }
  for (const [i, c] of [[L + 1.0, 6.6], [L + 2.2, 7.5], [L + 1.0, 8.6], [L + 3.2, 9.2], [L + 3.6, 7.2], [L + 4.2, 6.2]].entries()) {
    spots.push({ key: `chat-${i + 1}`, kind: "chat", x: c[0], y: c[1], face: "front", via: [{ x: corridorX, y: c[1] }] });
  }

  return { cols, rows: nrows, zoneW, lx: L, corridorX, blocks, desks: blocks.flatMap((b) => b.desks), spots, features, lounge };
}

/** Waypoints from a desk seat out to the shared corridor. */
export function deskExit(l: Layout, d: Desk): Pt[] {
  const b = l.blocks[d.block];
  // Step out beside the desk (the one-tile gap to its right), then down to the aisle.
  return [
    { x: d.seat.x, y: d.seat.y },
    { x: d.x + 2.5, y: d.seat.y },
    { x: d.x + 2.5, y: d.aisleY },
    { x: b.corrX, y: d.aisleY },
    { x: b.corrX, y: b.laneY },
    { x: l.corridorX, y: b.laneY },
  ];
}

export function spotExit(_l: Layout, s: Spot): Pt[] {
  return [{ x: s.x, y: s.y }, ...[...s.via].reverse()];
}

/** Walk plan between two anchors: out along the first one's exit, in along the second one's reverse exit. */
export function routeBetween(outPts: Pt[], inPts: Pt[]): Pt[] {
  const path = [...outPts.slice(1), ...[...inPts].reverse()];
  // drop consecutive duplicates
  return path.filter((p, i) => i === 0 || Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) > 0.01);
}
