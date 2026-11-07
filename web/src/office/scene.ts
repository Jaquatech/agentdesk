import type { AgentState, Role } from "../api.ts";
import type { Look, OfficeStyle } from "./palette.ts";
import { drawCharacter, drawPlant, px, shade, type Ctx } from "./draw.ts";

/** The office: a fixed room, one desk per agent, a lounge for idle agents. Logical size 384×224. */
export const W = 384;
export const H = 224;
const WALL_H = 52;
const LANE_X = 246; // open walkway between desks and lounge
const DESK_W = 40;
const DESK_COLS = 4;
const DESK_X0 = 18;
const DESK_DX = 56;
const ROW_Y = [92, 138, 184]; // desk top edge per row; agents sit just above it

export type OfficeAgent = {
  id: number; name: string; role: Role; look: Look;
  state: AgentState; detail?: string;
};

type Sprite = {
  id: number; x: number; y: number; path: { x: number; y: number }[];
  spot: string; facing: 1 | -1; arrivedAt: number;
};

type Spot = { key: string; x: number; y: number; pose: "sit" | "sitBack" | "stand"; holding?: "cup" };

const LOUNGE: Spot[] = [
  { key: "sofa-1", x: 298, y: 156, pose: "sitBack" },
  { key: "sofa-2", x: 314, y: 156, pose: "sitBack" },
  { key: "sofa-3", x: 330, y: 156, pose: "sitBack" },
  { key: "coffee", x: 268, y: 74, pose: "stand", holding: "cup" },
  { key: "beanbag-1", x: 276, y: 204, pose: "sitBack" },
  { key: "beanbag-2", x: 356, y: 204, pose: "sitBack" },
  { key: "window", x: 362, y: 92, pose: "stand", holding: "cup" },
  { key: "plant", x: 262, y: 118, pose: "stand" },
];

export function deskPos(i: number) {
  const row = Math.floor(i / DESK_COLS) % ROW_Y.length;
  const col = i % DESK_COLS;
  return { x: DESK_X0 + col * DESK_DX, y: ROW_Y[row] };
}
const seatOf = (i: number) => { const d = deskPos(i); return { x: d.x + DESK_W / 2, y: d.y }; };

export class OfficeScene {
  private sprites = new Map<number, Sprite>();
  agents: OfficeAgent[] = [];
  company = "My Company";
  hover: number | null = null;

  setAgents(agents: OfficeAgent[]) {
    this.agents = agents;
    for (const a of agents) {
      if (!this.sprites.has(a.id)) {
        const desk = this.deskIndex(a.id);
        const s = seatOf(desk);
        this.sprites.set(a.id, { id: a.id, x: s.x, y: s.y, path: [], spot: `desk`, facing: 1, arrivedAt: 0 });
      }
    }
    for (const id of [...this.sprites.keys()]) if (!agents.some((a) => a.id === id)) this.sprites.delete(id);
  }

  private deskIndex(id: number) {
    // Planners first, then developers, then reviewers: the architect sits at the front.
    const order = [...this.agents].sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.id - b.id);
    return Math.max(0, order.findIndex((a) => a.id === id));
  }

  private loungeSpot(id: number): Spot {
    const idle = this.agents.filter((a) => a.state === "idle").sort((a, b) => a.id - b.id);
    const i = Math.max(0, idle.findIndex((a) => a.id === id));
    // Rotate who gets the sofa every few minutes so everyone gets to play.
    const shift = Math.floor(Date.now() / 180_000);
    return LOUNGE[(i + shift) % LOUNGE.length];
  }

  /** Advances walking; call every frame. */
  update(dt: number, now: number) {
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id)!;
      const working = a.state !== "idle";
      const targetKey = working ? "desk" : this.loungeSpot(a.id).key;
      if (sp.spot !== targetKey) {
        const target = working ? seatOf(this.deskIndex(a.id)) : this.loungeSpot(a.id);
        sp.path = route(sp, target);
        sp.spot = targetKey;
      }
      if (sp.path.length) {
        const next = sp.path[0];
        const dx = next.x - sp.x, dy = next.y - sp.y;
        const dist = Math.hypot(dx, dy);
        const step = dt * 0.045; // px per ms
        if (dx) sp.facing = dx > 0 ? 1 : -1;
        if (dist <= step) { sp.x = next.x; sp.y = next.y; sp.path.shift(); if (!sp.path.length) sp.arrivedAt = now; }
        else { sp.x += (dx / dist) * step; sp.y += (dy / dist) * step; }
      }
    }
  }

  hitTest(x: number, y: number): number | null {
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id)!;
      if (Math.abs(x - sp.x) <= 6 && y <= sp.y + 1 && y >= sp.y - 20) return a.id;
    }
    return null;
  }

  // ---------- drawing ----------

  draw(ctx: Ctx, s: OfficeStyle, t: number) {
    this.drawRoom(ctx, s, t);
    const anyGaming = this.agents.some((a) => a.state === "idle" && this.atSpot(a.id) && this.loungeSpot(a.id).key.startsWith("sofa"));
    this.drawTv(ctx, s, t, anyGaming);

    // Depth sort: desks and people by their baseline.
    type Item = { z: number; draw: () => void };
    const items: Item[] = [];
    const deskCount = Math.max(this.agents.length, 4);
    for (let i = 0; i < Math.min(deskCount, DESK_COLS * ROW_Y.length); i++) {
      const owner = this.agents.find((a) => this.deskIndex(a.id) === i);
      const d = deskPos(i);
      items.push({ z: d.y + 12, draw: () => this.drawDesk(ctx, s, d.x, d.y, owner, t) });
    }
    items.push({ z: 168, draw: () => this.drawSofa(ctx, s) });
    items.push({ z: 210, draw: () => this.drawBeanbags(ctx, s) });
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id)!;
      const atDesk = !sp.path.length && sp.spot === "desk";
      const spot = !sp.path.length && sp.spot !== "desk" ? LOUNGE.find((l) => l.key === sp.spot) : undefined;
      const z = atDesk ? sp.y + 1 : spot?.pose === "sitBack" ? sp.y + 20 : sp.y;
      items.push({
        z, draw: () => {
          const pose = sp.path.length ? "walk" : atDesk ? (["typing", "running"].includes(a.state) ? "type" : "sit") : spot?.pose ?? "stand";
          drawCharacter(ctx, sp.x, sp.y, a.look, pose, t + a.id * 97, { facing: sp.path.length ? sp.facing : undefined, holding: spot?.holding });
          if (this.hover === a.id) { ctx.globalAlpha = 0.35; px(ctx, sp.x - 6, sp.y + 1, 12, 1, "#ffffff"); ctx.globalAlpha = 1; }
        },
      });
    }
    items.sort((a, b) => a.z - b.z).forEach((i) => i.draw());

    // light overlay for the night style
    if (s.label === "Night shift") { ctx.globalAlpha = 0.12; px(ctx, 0, 0, W, H, "#000020"); ctx.globalAlpha = 1; }
  }

  private atSpot(id: number) { const sp = this.sprites.get(id); return !!sp && !sp.path.length; }

  /** Text pass on the full-resolution canvas: company sign, name tags, speech bubbles. */
  drawLabels(ctx: Ctx, s: OfficeStyle, scale: number, ox: number, oy: number, t: number) {
    const X = (x: number) => ox + x * scale, Y = (y: number) => oy + y * scale;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = s.signText;
    ctx.font = `600 ${Math.max(10, Math.round(scale * 4.2))}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(this.company.slice(0, 28), X(82), Y(19));

    const small = Math.max(10, Math.round(scale * 3.3));
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id)!;
      const atDesk = !sp.path.length && sp.spot === "desk";
      // name tag
      ctx.font = `500 ${small}px ${getComputedStyle(document.body).fontFamily}`;
      const label = a.name;
      const w = ctx.measureText(label).width + 8;
      const ny = atDesk ? Y(sp.y + 15) : Y(sp.y + 4);
      ctx.fillStyle = "rgba(15,18,16,.72)";
      roundRect(ctx, X(sp.x) - w / 2, ny - small * 0.7, w, small * 1.4, 4);
      ctx.fillStyle = roleColor(a.role);
      ctx.fillText(label, X(sp.x), ny);

      // bubble
      const bubble = bubbleText(a, atDesk);
      if (!bubble) continue;
      const text = bubble.length > 34 ? bubble.slice(0, 33) + "…" : bubble;
      const bw = ctx.measureText(text).width + 12;
      const by = Y(sp.y - 25) - (Math.floor(t / 600) % 2 ? 1 : 0);
      const bx = Math.min(Math.max(X(sp.x) - bw / 2, ox + 2), ox + W * scale - bw - 2);
      ctx.fillStyle = a.state === "error" ? "#b8433a" : "rgba(255,253,248,.95)";
      roundRect(ctx, bx, by - small * 0.8, bw, small * 1.6, 6);
      ctx.beginPath();
      ctx.moveTo(X(sp.x) - 4, by + small * 0.8);
      ctx.lineTo(X(sp.x) + 4, by + small * 0.8);
      ctx.lineTo(X(sp.x), by + small * 0.8 + 5);
      ctx.fill();
      ctx.fillStyle = a.state === "error" ? "#fff" : "#1f2421";
      ctx.fillText(text, bx + bw / 2, by);
    }
  }

  private drawRoom(ctx: Ctx, s: OfficeStyle, t: number) {
    // floor planks
    for (let y = WALL_H; y < H; y += 8) {
      for (let x = 0; x < W + 32; x += 32) {
        const off = ((y / 8) % 2) * 16;
        px(ctx, x - off, y, 32, 8, ((x + y) / 8) % 3 === 0 ? s.floorB : s.floorA);
        px(ctx, x - off, y + 7, 32, 1, s.floorLine);
        px(ctx, x - off + 31, y, 1, 8, s.floorLine);
      }
    }
    // wall
    px(ctx, 0, 0, W, WALL_H, s.wall);
    for (let x = 0; x < W; x += 24) px(ctx, x, 0, 1, WALL_H - 6, s.wallShadow);
    px(ctx, 0, WALL_H - 6, W, 4, s.wallTrim);
    px(ctx, 0, WALL_H - 2, W, 2, shade(s.wallTrim, -0.1));

    // company sign
    px(ctx, 22, 8, 120, 22, shade(s.sign, -0.15));
    px(ctx, 21, 7, 120, 22, s.sign);
    // window with sky
    const wx = 168, wy = 6, ww = 64, wh = 34;
    px(ctx, wx - 2, wy - 2, ww + 4, wh + 4, s.windowFrame);
    for (let i = 0; i < wh; i++) px(ctx, wx, wy + i, ww, 1, i < wh / 2 ? s.sky[0] : s.sky[1]);
    const cloudX = wx + ((t / 300) % (ww + 20)) - 20;
    if (s.label !== "Night shift") { px(ctx, Math.max(wx, cloudX), wy + 8, Math.min(14, wx + ww - Math.max(wx, cloudX)), 4, "#ffffffcc"); }
    else { for (let i = 0; i < 9; i++) px(ctx, wx + ((i * 23) % ww), wy + ((i * 11) % 14) + 2, 1, 1, Math.floor(t / 500 + i) % 3 ? "#ffffff" : "#8899ff"); }
    px(ctx, wx + ww / 2 - 1, wy, 2, wh, s.windowFrame);
    px(ctx, wx, wy + wh / 2 - 1, ww, 2, s.windowFrame);
    // clock
    px(ctx, 246, 10, 14, 14, "#f4f1ea");
    px(ctx, 252, 12, 1, 6, "#1f2421");
    const ang = (t / 1000) * (Math.PI / 30);
    px(ctx, Math.round(252 + Math.cos(ang) * 4), Math.round(17 + Math.sin(ang) * 4), 1, 1, "#b8433a");
    // whiteboard above the architect's desk
    px(ctx, 18, 34, 40, 2, "#9a9a9a");
    // rug in the lounge
    px(ctx, 270, 112, 104, 76, s.rugEdge);
    px(ctx, 272, 114, 100, 72, s.rug);
    for (let x = 276; x < 370; x += 8) px(ctx, x, 118, 4, 1, shade(s.rug, 0.08));
    // coffee machine + counter
    px(ctx, 256, 52, 34, 14, s.desk);
    px(ctx, 256, 52, 34, 2, s.deskTop);
    px(ctx, 260, 38, 12, 14, "#3a3f45");
    px(ctx, 262, 40, 8, 3, "#b8433a");
    px(ctx, 264, 46, 4, 4, "#f4f1ea");
    if (Math.floor(t / 300) % 4 === 0) px(ctx, 265, 34, 1, 2, "#ffffff88");
    // plants and lamp
    drawPlant(ctx, 2, 214, s, true, t);
    drawPlant(ctx, 236, 86, s, false, t);
    drawPlant(ctx, 370, 70, s, true, t);
    px(ctx, 238, 160, 2, 40, "#2b2b2b");
    px(ctx, 234, 156, 10, 5, s.lamp);
  }

  private drawTv(ctx: Ctx, s: OfficeStyle, t: number, gaming: boolean) {
    const x = 292, y = 10, w = 52, h = 30;
    px(ctx, x - 2, y - 2, w + 4, h + 4, "#16181c");
    px(ctx, x, y, w, h, gaming ? "#0b1a2a" : "#1d2430");
    if (gaming) {
      // a little pong match
      const by = y + 4 + Math.abs(((t / 12) % (2 * (h - 8))) - (h - 8));
      const bx = x + 4 + Math.abs(((t / 9) % (2 * (w - 8))) - (w - 8));
      px(ctx, x + 3, Math.min(y + h - 9, Math.max(y + 1, by - 3)), 2, 8, "#6ee7b7");
      px(ctx, x + w - 5, Math.min(y + h - 9, Math.max(y + 1, by - 2 + Math.sin(t / 300) * 3)), 2, 8, "#fbbf24");
      px(ctx, bx, by, 2, 2, "#ffffff");
      for (let i = y + 2; i < y + h - 2; i += 4) px(ctx, x + w / 2, i, 1, 2, "#ffffff55");
    } else {
      const glow = Math.floor(t / 1500) % 3;
      px(ctx, x + 18 + glow * 4, y + 12, 8, 6, shade(s.lamp, -0.2));
    }
    // console under the TV
    px(ctx, x + 18, y + h + 4, 16, 4, "#2b2f36");
    px(ctx, x + 30, y + h + 5, 2, 1, gaming ? "#6ee7b7" : "#555");
  }

  private drawSofa(ctx: Ctx, s: OfficeStyle) {
    // seen from behind: the people on it face the TV
    const x = 286, y = 150;
    px(ctx, x, y, 56, 16, s.sofa);
    px(ctx, x, y, 56, 3, shade(s.sofa, 0.08));
    px(ctx, x - 4, y + 2, 5, 14, s.sofaDark);
    px(ctx, x + 55, y + 2, 5, 14, s.sofaDark);
    px(ctx, x + 18, y + 3, 1, 12, s.sofaDark);
    px(ctx, x + 37, y + 3, 1, 12, s.sofaDark);
    px(ctx, x, y + 16, 56, 2, shade(s.sofaDark, -0.15));
  }

  private drawBeanbags(ctx: Ctx, s: OfficeStyle) {
    for (const bx of [270, 350]) {
      px(ctx, bx, 198, 14, 10, s.sofaDark);
      px(ctx, bx + 1, 197, 12, 3, s.sofa);
    }
  }

  private drawDesk(ctx: Ctx, s: OfficeStyle, x: number, y: number, owner: OfficeAgent | undefined, t: number) {
    // chair back (behind the person)
    // desk
    px(ctx, x, y, DESK_W, 4, s.deskTop);
    px(ctx, x, y + 4, DESK_W, 8, s.desk);
    px(ctx, x, y + 11, DESK_W, 1, s.deskEdge);
    px(ctx, x + 2, y + 12, 2, 6, s.deskEdge);
    px(ctx, x + DESK_W - 4, y + 12, 2, 6, s.deskEdge);
    // monitor (we see its back; the screen light spills onto the desk)
    const working = owner && owner.state !== "idle";
    px(ctx, x + 4, y - 7, 14, 9, "#2b2f36");
    px(ctx, x + 10, y + 1, 2, 2, "#2b2f36");
    if (working) {
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t / 200);
      px(ctx, x + 3, y, 16, 3, owner!.state === "error" ? "#ff6b5e" : owner!.state === "running" ? "#6ee7b7" : "#9fd3ff");
      ctx.globalAlpha = 1;
    }
    // role props
    if (owner?.role === "planner") {
      px(ctx, x + 26, y + 1, 10, 2, "#f4f1ea");
      px(ctx, x + 27, y + 1, 6, 1, "#3f7fd0");
    } else if (owner?.role === "reviewer") {
      px(ctx, x + 26, y, 7, 3, "#f4f1ea");
      px(ctx, x + 34, y - 1, 3, 3, "#c9cfd6");
      px(ctx, x + 36, y + 1, 2, 1, "#8a6a3a");
    } else if (owner) {
      px(ctx, x + 30, y - 1, 3, 3, "#f4f1ea");
      if (working && Math.floor(t / 500) % 2) px(ctx, x + 31, y - 3, 1, 1, "#ffffff88");
    } else {
      px(ctx, x + 22, y + 1, 8, 2, shade(s.deskTop, -0.06));
    }
  }
}

function roleRank(r: Role) { return r === "planner" ? 0 : r === "worker" ? 1 : 2; }

export function roleColor(r: Role) {
  return r === "planner" ? "#f2c66d" : r === "reviewer" ? "#9fd3ff" : "#9ee6b0";
}

function bubbleText(a: OfficeAgent, atDesk: boolean): string | null {
  if (a.state === "idle") return null;
  if (!atDesk) return "on my way…";
  if (a.state === "waiting" && a.detail === "needs your OK") return "✋ needs your OK";
  const d = a.detail ? ` ${a.detail}` : "";
  switch (a.state) {
    case "thinking": return `💭${a.detail && !a.detail.startsWith("turn") ? d : " thinking"}`;
    case "reading": return `📖${d}`;
    case "typing": return `⌨️${d}`;
    case "running": return `▶${d}`;
    case "reviewing": return `🔍${d || " reviewing"}`;
    case "waiting": return `⏳${d || " waiting"}`;
    case "error": return `⚠${d}`;
    default: return null;
  }
}

function route(from: { x: number; y: number }, to: { x: number; y: number }) {
  // Along the own row to the walkway, along the walkway, then across to the target.
  const pts = [{ x: LANE_X, y: from.y }, { x: LANE_X, y: to.y }, { x: to.x, y: to.y }];
  return pts.filter((p, i) => i === pts.length - 1 || Math.hypot(p.x - from.x, p.y - from.y) > 0.5);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
