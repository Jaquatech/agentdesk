import type { AgentState, Role } from "../api.ts";
import type { Look, OfficeStyle } from "./palette.ts";
import { Iso, HH, UZ, shade, roundRectPath, type Ctx } from "./iso.ts";
import {
  DEFAULT_FEATURES, WALL_Z, buildLayout, deskExit, routeBetween, spotExit,
  type Desk, type Features, type Layout, type Pt, type Spot, type TeamInfo,
} from "./layout.ts";
import { drawPerson, personHeight, type Dir, type Pose } from "./people.ts";
import { renderLogo, type LogoSpec } from "./logo.ts";
import * as P from "./props.ts";

export type OfficeAgent = {
  id: number; name: string; role: Role; look: Look;
  state: AgentState; detail?: string;
};

type Sprite = {
  id: number; x: number; y: number; path: Pt[]; dir: Dir;
  at: string; exit: Pt[]; spotKey: string; spotUntil: number;
};

type Item = { x0: number; x1: number; y0: number; y1: number; draw: () => void; shadow?: [number, number, number, number, number] };

export function roleColor(r: Role) {
  return r === "planner" ? "#f2c66d" : r === "reviewer" ? "#9fd3ff" : "#9ee6b0";
}

const SPEED = 0.0026; // tiles per ms

export class OfficeScene {
  agents: OfficeAgent[] = [];
  teams: TeamInfo[] = [];
  features: Features = { ...DEFAULT_FEATURES };
  company = "My Company";
  logo: LogoSpec = { name: "My Company", shape: "circle", glyph: "monogram", color: "auto" };
  hover: number | null = null;
  selected: number | null = null;
  layout: Layout = buildLayout([], [], DEFAULT_FEATURES);

  private sprites = new Map<number, Sprite>();
  private layoutKey = "";
  private hits = new Map<number, { x: number; y: number; w: number; h: number }>();
  private logoCanvas: HTMLCanvasElement | null = null;
  private logoKey = "";
  private logoImage: unknown = null;

  configure(o: { features: Features; teams: TeamInfo[]; logo: LogoSpec }) {
    this.features = o.features; this.teams = o.teams; this.logo = o.logo; this.company = o.logo.name;
    this.rebuild();
  }

  setAgents(agents: OfficeAgent[]) {
    this.agents = agents;
    this.rebuild();
    for (const id of [...this.sprites.keys()]) if (!agents.some((a) => a.id === id)) this.sprites.delete(id);
    for (const a of agents) if (!this.sprites.has(a.id)) this.place(a);
  }

  private rebuild() {
    const key = JSON.stringify([this.agents.map((a) => [a.id, a.role]), this.teams, this.features]);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.layout = buildLayout(this.agents.map((a) => ({ id: a.id, role: a.role })), this.teams, this.features);
    this.sprites.clear(); // everyone starts at the right place in the new layout
    for (const a of this.agents) this.place(a);
  }

  private deskOf(id: number): Desk | undefined { return this.layout.desks.find((d) => d.agentId === id); }

  private place(a: OfficeAgent) {
    const w = this.wantedAnchor(a, Date.now(), new Set());
    const p = w.exit[0];
    this.sprites.set(a.id, { id: a.id, x: p.x, y: p.y, path: [], dir: "fl", at: w.key, exit: w.exit, spotKey: w.spot?.key ?? "", spotUntil: w.spot ? Date.now() + 20000 : 0 });
  }

  /** Where this agent wants to be right now: its desk when working, otherwise a spot in the lounge. */
  private wantedAnchor(a: OfficeAgent, now: number, taken: Set<string>): { key: string; exit: Pt[]; spot?: Spot } {
    const L = this.layout;
    const desk = this.deskOf(a.id);
    if (a.state !== "idle" && desk) return { key: "desk", exit: deskExit(L, desk) };
    const sp = this.sprites.get(a.id);
    let spot = sp && sp.spotKey ? L.spots.find((s) => s.key === sp.spotKey) : undefined;
    if (!spot || (sp && sp.spotUntil < now) || (sp && sp.at === "desk")) {
      const free = L.spots.filter((s) => !taken.has(s.key));
      const pool = free.length ? free : L.spots;
      const bucket = Math.floor(now / 7000);
      let pick = pool[(a.id * 7 + bucket * 3 + ((a.id * 31) % 5)) % pool.length];
      if (spot && pick.key === spot.key && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      spot = pick;
      if (sp) { sp.spotKey = spot.key; sp.spotUntil = now + 28000 + ((a.id * 977 + bucket * 131) % 32000); }
    }
    taken.add(spot.key);
    return { key: spot.key, exit: spotExit(L, spot), spot };
  }

  /** Advances walking; call every frame. */
  update(dt: number, now: number) {
    const taken = new Set<string>();
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id);
      if (sp && sp.spotKey && a.state === "idle" && sp.at !== "desk") taken.add(sp.spotKey);
    }
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id);
      if (!sp) continue;
      if (!sp.path.length) {
        const w = this.wantedAnchor(a, now, taken);
        if (w.key !== sp.at) {
          sp.path = routeBetween(sp.exit, w.exit);
          sp.at = w.key;
          sp.exit = w.exit;
          if (w.spot) sp.spotKey = w.spot.key;
        }
      }
      if (sp.path.length) {
        const next = sp.path[0];
        const dx = next.x - sp.x, dy = next.y - sp.y;
        const dist = Math.hypot(dx, dy);
        const step = dt * SPEED;
        if (dist > 0.001) sp.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "fr" : "bl") : dy > 0 ? "fl" : "br";
        if (dist <= step) { sp.x = next.x; sp.y = next.y; sp.path.shift(); }
        else { sp.x += (dx / dist) * step; sp.y += (dy / dist) * step; }
      }
    }
  }

  /** Hit test in canvas pixels. */
  hitTest(px: number, py: number): number | null {
    let best: number | null = null, bestY = -1e9;
    for (const [id, h] of this.hits) {
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h && h.y > bestY) { best = id; bestY = h.y; }
    }
    return best;
  }

  private atSpot(sp: Sprite) { return !sp.path.length && sp.at !== "desk" ? this.layout.spots.find((s) => s.key === sp.at) : undefined; }

  /* -------------------------------------------------------------- drawing */

  private emblem(s: OfficeStyle) {
    const key = [this.logo.name, this.logo.shape, this.logo.glyph, this.logo.color, s.label, s.sign].join("|");
    if (!this.logoCanvas || key !== this.logoKey || (this.logo.image ?? null) !== this.logoImage) {
      this.logoKey = key; this.logoImage = this.logo.image ?? null;
      this.logoCanvas = renderLogo(this.logo, s, 256);
    }
    return this.logoCanvas;
  }

  /** Fits the room into the canvas and returns the projection. */
  fit(w: number, h: number): Iso {
    const L = this.layout;
    const padX = 24, padTop = 30, padBottom = 40;
    const widthU = L.cols + L.rows;
    const heightU = (L.cols + L.rows) * HH + WALL_Z * UZ + 0.3;
    const k = Math.max(8, Math.min((w - padX * 2) / widthU, (h - padTop - padBottom) / heightU, 64));
    const totalH = heightU * k;
    const ox = w / 2 - ((L.cols - L.rows) / 2) * k;
    const oy = padTop + Math.max(0, (h - padTop - padBottom - totalH) / 2) + WALL_Z * UZ * k;
    return new Iso(k, ox, oy);
  }

  draw(ctx: Ctx, w: number, h: number, s: OfficeStyle, t: number) {
    const L = this.layout, F = this.features;
    const iso = this.fit(w, h);
    const bg = ctx.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h * 0.5, Math.max(w, h) * 0.75);
    bg.addColorStop(0, shade(s.backdrop, 0.07)); bg.addColorStop(1, shade(s.backdrop, -0.02));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = "round";

    // ---- room
    P.drawFloor(ctx, iso, L, s);
    P.drawBlockCarpets(ctx, iso, L);
    if (F.decor || F.sofa || F.table) P.drawRug(ctx, iso, s, L.lounge.rug);
    P.drawWalls(ctx, iso, L, s);

    // windows, sign, clock, posters
    const logoCx = L.zoneW / 2;
    const signL = logoCx - 1.7 - 0.4, signR = logoCx + 1.7 + 0.4;
    for (let x = 0.7; x + 2.2 < L.zoneW + 0.2; x += 3.5) {
      if (x + 2.2 > signL && x < signR) continue;
      P.drawWindow(ctx, iso, s, x, t, L);
    }
    P.drawLogoSign(ctx, iso, s, logoCx, this.company, this.emblem(s));
    if (F.decor) {
      P.drawClock(ctx, iso, L.lx + 6.9, t);
      P.drawPosterBack(ctx, iso, s, L.lx + 0.4, 0);
      P.drawPosterBack(ctx, iso, s, L.lx + 1.6, 2);
    }
    P.drawLeftWallDecor(ctx, iso, s, L, F.decor, t);

    // ---- things with depth
    const items: Item[] = [];
    const add = (x0: number, y0: number, x1: number, y1: number, draw: () => void, shadow?: Item["shadow"]) => items.push({ x0, x1, y0, y1, draw, shadow });
    const L2 = L.lounge;
    const gaming = this.agents.some((a) => { const sp = this.sprites.get(a.id); const spot = sp && this.atSpot(sp); return a.state === "idle" && spot?.kind === "sofa"; });

    for (const d of L.desks) {
      const owner = d.agentId != null ? this.agents.find((a) => a.id === d.agentId) : undefined;
      const sp = owner ? this.sprites.get(owner.id) : undefined;
      const seated = !!sp && !sp.path.length && sp.at === "desk";
      const info = owner ? { state: seated ? owner.state : ("idle" as AgentState), role: owner.role } : null;
      add(d.x, d.y, d.x + 2, d.y + 1, () => P.drawDesk(ctx, iso, s, d, info, seated, F.plants, t), [d.x, d.y, 2, 1, 0.14]);
    }
    for (const b of L.blocks) {
      if (F.plants) add(b.x + 0.35, b.y + b.h - 0.9, b.x + 0.75, b.y + b.h - 0.5, () => P.drawPlant(ctx, iso, s, b.x + 0.55, b.y + b.h - 0.7, !b.glass, t));
      if (!b.glass) continue;
      for (const seg of P.glassSegments(b)) {
        add(Math.min(seg.x0, seg.x1) - 0.03, Math.min(seg.y0, seg.y1) - 0.03, Math.max(seg.x0, seg.x1) + 0.03, Math.max(seg.y0, seg.y1) + 0.03, () => P.drawGlassSegment(ctx, iso, seg, b.color));
      }
      const posts: Pt[] = [{ x: b.x + b.w, y: b.y + b.h }, { x: b.x + b.w - 1, y: b.y + b.h }];
      if (b.y > 0) posts.push({ x: b.x + b.w, y: b.y });
      if (b.x > 0) posts.push({ x: b.x, y: b.y + b.h });
      if (b.x > 0 && b.y > 0) posts.push({ x: b.x, y: b.y });
      for (const p of posts) add(p.x - 0.05, p.y - 0.05, p.x + 0.05, p.y + 0.05, () => P.drawGlassPost(ctx, iso, p.x, p.y, b.color));
      add(b.x + b.w - 1, b.y + b.h - 0.5, b.x + b.w, b.y + b.h + 0.02, () => P.drawDoor(ctx, iso, b));
    }
    if (F.coffee) add(L2.counter.x, L2.counter.y, L2.counter.x + L2.counter.w, L2.counter.y + L2.counter.d, () => P.drawCounter(ctx, iso, s, L2.counter, t), [L2.counter.x, L2.counter.y, L2.counter.w, L2.counter.d, 0.16]);
    if (F.sofa) {
      add(L2.tv.x, 0, L2.tv.x + L2.tv.w, 0.5, () => P.drawTv(ctx, iso, s, L2, gaming, t), [L2.tv.x, 0, L2.tv.w, 0.5, 0.12]);
      const f = L2.sofa;
      add(f.x, f.y, f.x + f.w, f.y + f.d, () => P.drawSofa(ctx, iso, s, f), [f.x, f.y, f.w, f.d, 0.2]);
    }
    if (F.table) { const f = L2.table; add(f.x, f.y, f.x + f.w, f.y + f.d, () => P.drawCoffeeTable(ctx, iso, s, f), [f.x, f.y, f.w, f.d, 0.14]); }
    if (F.arcade) { const f = L2.arcade; add(f.x, f.y, f.x + f.w + 0.2, f.y + f.d, () => P.drawArcade(ctx, iso, s, f, t), [f.x, f.y, f.w + 0.15, f.d, 0.2]); }
    if (F.slots) { const f = L2.slots; add(f.x, f.y, f.x + f.w, f.y + f.d, () => P.drawSlots(ctx, iso, s, f, t), [f.x, f.y, f.w, f.d, 0.2]); }
    if (F.decor) {
      const f = L2.shelf; add(f.x, f.y, f.x + f.w, f.y + f.d, () => P.drawShelf(ctx, iso, s, f), [f.x, f.y, f.w, f.d, 0.14]);
      add(L2.lamp.x - 0.2, L2.lamp.y - 0.2, L2.lamp.x + 0.2, L2.lamp.y + 0.2, () => P.drawLamp(ctx, iso, s, L2.lamp, !!s.dark));
    }
    if (F.plants) for (const p of L2.plants) add(p.x - 0.25, p.y - 0.25, p.x + 0.25, p.y + 0.25, () => P.drawPlant(ctx, iso, s, p.x, p.y, p.big, t));

    // people
    this.hits.clear();
    const labels: (() => void)[] = [];
    for (const a of this.agents) {
      const sp = this.sprites.get(a.id);
      if (!sp) continue;
      const walking = sp.path.length > 0;
      const spot = this.atSpot(sp);
      let pose: Pose = "stand", dir: Dir = sp.dir, chair = false;
      const bx0 = sp.x - 0.22, bx1 = sp.x + 0.22;
      let by0 = sp.y - 0.22, by1 = sp.y + 0.22;
      if (walking) pose = "walk";
      else if (sp.at === "desk") {
        pose = ["typing", "running"].includes(a.state) ? "type" : "sit"; dir = "fl"; chair = true;
        const d = this.deskOf(a.id);
        if (d) { by0 = d.y - 0.7; by1 = d.y - 0.001; }
      } else if (spot) {
        dir = spot.face === "front" ? "fl" : "br";
        pose = spot.kind === "sofa" ? "sitBack" : spot.kind === "coffee" ? "coffee" : spot.kind === "arcade" ? "play" : spot.kind === "slots" ? "pull" : "chat";
        if (spot.kind === "sofa") { by0 = L2.sofa.y - 0.6; by1 = L2.sofa.y - 0.001; }
      }
      const mood = a.state === "error" ? "error" : a.state === "thinking" ? "think" : "ok";
      const [sx, sy] = iso.p(sp.x, sp.y);
      const hgt = personHeight(iso.k);
      this.hits.set(a.id, { x: sx - iso.k * 0.45, y: sy - hgt, w: iso.k * 0.9, h: hgt + iso.k * 0.25 });
      items.push({
        x0: bx0, x1: bx1, y0: by0, y1: by1,
        draw: () => {
          drawPerson(ctx, sx, sy, iso.k, a.look, { pose, dir, t: t + a.id * 97, mood, chair, chairColor: "#5d6877" });
          if (this.hover === a.id || this.selected === a.id) {
            ctx.strokeStyle = this.selected === a.id ? "#ffffff" : "#ffffffaa"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(sx, sy + 1, iso.k * 0.42, iso.k * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
          }
        },
      });
      const atDesk = !walking && sp.at === "desk";
      labels.push(() => this.label(ctx, iso, a, sx, sy, hgt, walking, atDesk, spot, t));
    }

    // shadows first, then the sorted things
    ctx.fillStyle = "#000";
    for (const it of items) {
      if (!it.shadow) continue;
      const [x, y, ww, dd, al] = it.shadow;
      ctx.globalAlpha = al;
      ctx.beginPath();
      [iso.p(x + 0.1, y + 0.1), iso.p(x + ww + 0.28, y + 0.1), iso.p(x + ww + 0.28, y + dd + 0.28), iso.p(x + 0.1, y + dd + 0.28)]
        .forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    sortItems(items).forEach((i) => i.draw());

    if (s.dark) { ctx.globalAlpha = 0.1; ctx.fillStyle = "#000030"; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }

    // team labels and name tags on top
    for (const b of L.blocks) if (b.glass) this.teamLabel(ctx, iso, b);
    labels.forEach((f) => f());
  }

  private teamLabel(ctx: Ctx, iso: Iso, b: Layout["blocks"][number]) {
    const [x0, y] = iso.p(b.x + 0.2, b.y + b.h, 2.2);
    const size = Math.max(11, Math.round(iso.k * 0.42));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    const text = b.name.length > 22 ? b.name.slice(0, 21) + "…" : b.name;
    const tw = ctx.measureText(text).width + size * 1.6;
    ctx.fillStyle = "rgba(14,18,16,.82)";
    const x = x0 + tw / 2;
    roundRectPath(ctx, x - tw / 2, y - size * 0.95, tw, size * 1.9, size * 0.95); ctx.fill();
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x - tw / 2 + size * 0.85, y, size * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f4f1ea"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, x - tw / 2 + size * 1.35, y + 0.5);
  }

  private label(ctx: Ctx, iso: Iso, a: OfficeAgent, sx: number, sy: number, hgt: number, walking: boolean, atDesk: boolean, spot: Spot | undefined, t: number) {
    const small = Math.max(10, Math.round(iso.k * 0.36));
    ctx.font = `600 ${small}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const nw = ctx.measureText(a.name).width + 10;
    // seated people are half hidden by their desk, so their tag sits above the head; others get it under the feet
    const head = atDesk ? hgt - iso.k * 0.1 : hgt;
    const tagY = atDesk ? sy - head - small * 0.8 : sy + iso.k * 0.32;
    ctx.fillStyle = "rgba(15,18,16,.74)";
    roundRectPath(ctx, sx - nw / 2, tagY - small * 0.75, nw, small * 1.5, small * 0.75); ctx.fill();
    ctx.fillStyle = roleColor(a.role);
    ctx.fillText(a.name, sx, tagY + 0.5);

    const text = bubbleText(a, atDesk, walking, spot, t);
    if (!text) return;
    const shown = text.length > 34 ? text.slice(0, 33) + "…" : text;
    const bw = ctx.measureText(shown).width + 14;
    const by = (atDesk ? tagY - small * 1.9 : sy - hgt - small * 1.3) - (Math.floor(t / 600) % 2 ? 1 : 0);
    ctx.fillStyle = a.state === "error" ? "#b8433a" : "rgba(255,253,248,.96)";
    roundRectPath(ctx, sx - bw / 2, by - small * 0.85, bw, small * 1.7, small * 0.85); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx - 4, by + small * 0.8); ctx.lineTo(sx + 4, by + small * 0.8); ctx.lineTo(sx, by + small * 0.8 + 5); ctx.fill();
    ctx.fillStyle = a.state === "error" ? "#fff" : "#1f2421";
    ctx.fillText(shown, sx, by + 0.5);
  }
}

const IDLE_TALK: Record<string, string[]> = {
  arcade: ["🕹 one more round", "👾 they're coming!", "🏆 new high score"],
  slots: ["🎰 feeling lucky", "🍒🍒🍒 ?", "💰 come on…"],
  coffee: ["☕ refill", "☕ best part of the day"],
  sofa: ["🎮 my turn next", "🛋 five more minutes"],
  chat: ["💬 did you see the diff?", "💬 nice work"],
};

function bubbleText(a: OfficeAgent, atDesk: boolean, walking: boolean, spot: Spot | undefined, t: number): string | null {
  if (a.state === "idle") {
    if (walking || !spot) return null;
    const slot = Math.floor((t + a.id * 3300) / 4500);
    if (slot % 4 !== 0) return null;
    const lines = IDLE_TALK[spot.kind];
    return lines[Math.floor(slot / 4) % lines.length];
  }
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

/**
 * Painter's order for boxes on a grid seen from +x,+y: A goes before B when A lies entirely at smaller x or
 * smaller y. Pairs with no clear answer fall back to the distance of their centres.
 */
export function sortItems<T extends { x0: number; x1: number; y0: number; y1: number }>(items: T[]): T[] {
  const n = items.length;
  const key = items.map((i) => (i.x0 + i.x1) / 2 + (i.y0 + i.y1) / 2);
  const before = (a: T, b: T) => a.x1 <= b.x0 + 1e-6 || a.y1 <= b.y0 + 1e-6;
  const out: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ab = before(items[i], items[j]), ba = before(items[j], items[i]);
    if (ab && !ba) { out[i].push(j); indeg[j]++; }
    else if (ba && !ab) { out[j].push(i); indeg[i]++; }
  }
  const done = new Array<boolean>(n).fill(false);
  const result: T[] = [];
  for (let c = 0; c < n; c++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || key[i] < key[pick])) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || key[i] < key[pick])) pick = i; // cycle: break it
    done[pick] = true;
    result.push(items[pick]);
    for (const j of out[pick]) indeg[j]--;
  }
  return result;
}
