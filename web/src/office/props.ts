import type { AgentState, Role } from "../api.ts";
import type { OfficeStyle } from "./palette.ts";
import type { Block, Desk, Layout } from "./layout.ts";
import { WALL_Z } from "./layout.ts";
import { drawChair } from "./people.ts";
import { box, ellipse, faceX, faceY, fillRound, poly, quad, rnd, shade, type Ctx, type Iso } from "./iso.ts";

/* ---------------------------------------------------------------- floor and walls */

export function drawFloor(ctx: Ctx, iso: Iso, L: Layout, s: OfficeStyle) {
  // slab edges give the room some thickness
  const dark = shade(s.floorA, -0.34);
  poly(ctx, [iso.p(0, L.rows, 0), iso.p(L.cols, L.rows, 0), iso.p(L.cols, L.rows, -0.28), iso.p(0, L.rows, -0.28)], dark);
  poly(ctx, [iso.p(L.cols, 0, 0), iso.p(L.cols, L.rows, 0), iso.p(L.cols, L.rows, -0.28), iso.p(L.cols, 0, -0.28)], shade(dark, -0.1));
  for (let gx = 0; gx < L.cols; gx++) {
    for (let gy = 0; gy < L.rows; gy++) {
      const base = (gx + gy) % 2 ? s.floorB : s.floorA;
      const v = (rnd(gx * 131 + gy * 17) - 0.5) * 0.035;
      poly(ctx, [iso.p(gx, gy), iso.p(gx + 1, gy), iso.p(gx + 1, gy + 1), iso.p(gx, gy + 1)], shade(base, v), s.floorLine, 0.6);
    }
  }
}

export function drawBlockCarpets(ctx: Ctx, iso: Iso, L: Layout) {
  for (const b of L.blocks) {
    if (!b.glass) continue;
    ctx.globalAlpha = 0.22;
    quad(ctx, iso, b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, 0, b.color);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = b.color; ctx.lineWidth = 1.2;
    poly(ctx, [iso.p(b.x + 0.1, b.y + 0.1), iso.p(b.x + b.w - 0.1, b.y + 0.1), iso.p(b.x + b.w - 0.1, b.y + b.h - 0.1), iso.p(b.x + 0.1, b.y + b.h - 0.1)], undefined, b.color, 1.2);
    ctx.globalAlpha = 1;
  }
}

export function drawRug(ctx: Ctx, iso: Iso, s: OfficeStyle, r: Layout["lounge"]["rug"]) {
  quad(ctx, iso, r.x, r.y, r.w, r.d, 0.005, s.rugEdge);
  quad(ctx, iso, r.x + 0.18, r.y + 0.18, r.w - 0.36, r.d - 0.36, 0.006, s.rug);
  quad(ctx, iso, r.x + 0.45, r.y + 0.45, r.w - 0.9, r.d - 0.9, 0.007, shade(s.rug, 0.07));
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 6; i++) {
    const f = 0.7 + i * 0.5;
    poly(ctx, [iso.p(r.x + f, r.y + 0.5, 0.008), iso.p(r.x + f, r.y + r.d - 0.5, 0.008)], undefined, shade(s.rug, 0.16), 1);
  }
  ctx.globalAlpha = 1;
}

export function drawWalls(ctx: Ctx, iso: Iso, L: Layout, s: OfficeStyle) {
  const Wz = WALL_Z;
  const grad = (x1: number, y1: number, x2: number, y2: number, a: string, b: string) => {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, a); g.addColorStop(1, b);
    return g;
  };
  // back wall (plane y = 0)
  const bw = [iso.p(0, 0, 0), iso.p(L.cols, 0, 0), iso.p(L.cols, 0, Wz), iso.p(0, 0, Wz)] as [number, number][];
  poly(ctx, bw, grad(0, iso.y(0, 0, Wz), 0, iso.y(0, 0, 0), shade(s.wall, 0.05), shade(s.wall, -0.03)));
  // left wall (plane x = 0)
  const lw = [iso.p(0, 0, 0), iso.p(0, L.rows, 0), iso.p(0, L.rows, Wz), iso.p(0, 0, Wz)] as [number, number][];
  poly(ctx, lw, grad(0, iso.y(0, 0, Wz), 0, iso.y(0, L.rows, 0), shade(s.wall, -0.02), shade(s.wall, -0.1)));
  // wall panel seams
  ctx.globalAlpha = 0.5;
  for (let x = 2; x < L.cols; x += 2) poly(ctx, [iso.p(x, 0, 0.14), iso.p(x, 0, Wz)], undefined, s.wallShadow, 1);
  for (let y = 2; y < L.rows; y += 2) poly(ctx, [iso.p(0, y, 0.14), iso.p(0, y, Wz)], undefined, shade(s.wallShadow, -0.05), 1);
  ctx.globalAlpha = 1;
  // baseboards and cornice
  poly(ctx, [iso.p(0, 0, 0), iso.p(L.cols, 0, 0), iso.p(L.cols, 0, 0.16), iso.p(0, 0, 0.16)], s.wallTrim);
  poly(ctx, [iso.p(0, 0, 0), iso.p(0, L.rows, 0), iso.p(0, L.rows, 0.16), iso.p(0, 0, 0.16)], shade(s.wallTrim, -0.07));
  poly(ctx, [iso.p(0, 0, Wz - 0.1), iso.p(L.cols, 0, Wz - 0.1), iso.p(L.cols, 0, Wz), iso.p(0, 0, Wz)], shade(s.wallTrim, 0.04));
  poly(ctx, [iso.p(0, 0, Wz - 0.1), iso.p(0, L.rows, Wz - 0.1), iso.p(0, L.rows, Wz), iso.p(0, 0, Wz)], shade(s.wallTrim, -0.05));
  // wall caps (thickness)
  poly(ctx, [iso.p(0, 0, Wz), iso.p(L.cols, 0, Wz), iso.p(L.cols, -0.25, Wz), iso.p(0, -0.25, Wz)], shade(s.wallTrim, 0.1));
  poly(ctx, [iso.p(0, 0, Wz), iso.p(0, L.rows, Wz), iso.p(-0.25, L.rows, Wz), iso.p(-0.25, 0, Wz)], shade(s.wallTrim, 0.02));
  poly(ctx, [iso.p(0, 0, 0), iso.p(0, 0, Wz)], undefined, shade(s.wall, -0.2), 1.5);
}

/* ---------------------------------------------------------------- wall decor */

export function drawWindow(ctx: Ctx, iso: Iso, s: OfficeStyle, x0: number, t: number, L: Layout) {
  const w = 2.2, h = 1.6, zTop = 2.75;
  if (!s.dark) {
    ctx.globalAlpha = 0.07;
    poly(ctx, [iso.p(x0 + 0.1, 0.1), iso.p(x0 + w - 0.1, 0.1), iso.p(x0 + w + 1.5, 3.6), iso.p(x0 + 1.6, 3.6)], "#fff6d8");
    ctx.globalAlpha = 1;
  }
  faceY(ctx, iso, x0, 0, zTop, () => {
    const W = w * 100, H = h * 100;
    ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(-2, 4, W + 8, H + 8);
    ctx.fillStyle = s.windowFrame; ctx.fillRect(-8, -8, W + 16, H + 16);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, s.sky[0]); g.addColorStop(1, s.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (s.dark) {
      for (let i = 0; i < 16; i++) {
        const tw = Math.floor(t / 600 + i) % 4 ? 1 : 0.35;
        ctx.globalAlpha = tw; ctx.fillStyle = "#ffffff"; ctx.fillRect(rnd(i) * W, rnd(i + 50) * H * 0.55, 2.2, 2.2);
      }
      ctx.globalAlpha = 1; ellipse(ctx, W * 0.78, H * 0.24, 13, 13, "#f3efd8"); ellipse(ctx, W * 0.78 + 5, H * 0.24 - 3, 11, 11, s.sky[0]);
    } else {
      ellipse(ctx, W * 0.8, H * 0.24, 15, 15, "#fff1b8");
      ctx.globalAlpha = 0.85; ctx.fillStyle = "#ffffff";
      for (const [off, yy, sc] of [[0, 0.3, 1], [140, 0.5, 0.7]] as const) {
        const cx = ((t / 90 + off) % (W + 90)) - 45;
        ellipse(ctx, cx, H * yy, 26 * sc, 8 * sc, "#ffffff"); ellipse(ctx, cx + 14 * sc, H * yy - 5 * sc, 16 * sc, 8 * sc, "#ffffff"); ellipse(ctx, cx - 14 * sc, H * yy - 3 * sc, 14 * sc, 6 * sc, "#ffffff");
      }
      ctx.globalAlpha = 1;
    }
    // skyline
    const sky = s.dark ? "#10173a" : shade(s.sky[1], -0.22);
    ctx.fillStyle = sky;
    for (let i = 0; i < 9; i++) { const bh = 30 + rnd(i * 3 + 7) * 55; ctx.fillRect(i * 26 - 4, H - bh, 24, bh); }
    if (s.dark) {
      for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
        if (rnd(i * 31 + j) > 0.45) { ctx.fillStyle = Math.floor(t / 1500 + i + j) % 5 ? "#f6d77c" : "#4a5280"; ctx.fillRect(i * 26 + 3 + (j % 2) * 9, H - 18 - j * 11, 5, 5); }
      }
    }
    ctx.restore();
    ctx.fillStyle = s.windowFrame;
    ctx.fillRect(W / 2 - 3, 0, 6, H); ctx.fillRect(0, H * 0.45, W, 6);
    ctx.globalAlpha = 0.14; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(10, H); ctx.lineTo(70, 0); ctx.lineTo(100, 0); ctx.lineTo(40, H); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = shade(s.windowFrame, -0.14); ctx.fillRect(-14, H + 8, W + 28, 9);
  });
  void L;
}

export type Emblem = CanvasImageSource | null;

export function drawLogoSign(ctx: Ctx, iso: Iso, s: OfficeStyle, cx: number, name: string, emblem: Emblem) {
  const w = 3.4, zTop = 2.75, x0 = cx - w / 2;
  faceY(ctx, iso, x0, 0, zTop, () => {
    const W = w * 100, H = 150;
    ctx.fillStyle = "rgba(0,0,0,.16)"; fillRound(ctx, 6, 8, W, H, 14, "rgba(0,0,0,.16)");
    fillRound(ctx, 0, 0, W, H, 14, shade(s.sign, -0.2));
    fillRound(ctx, 4, 4, W - 8, H - 8, 11, s.sign);
    ctx.globalAlpha = 0.14; fillRound(ctx, 4, 4, W - 8, (H - 8) * 0.45, 11, "#fff"); ctx.globalAlpha = 1;
    if (emblem) ctx.drawImage(emblem, 22, 20, 110, 110);
    ctx.fillStyle = s.signText;
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const text = name.length > 26 ? name.slice(0, 25) + "…" : name;
    let size = 46;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    const maxW = W - 160;
    while (ctx.measureText(text).width > maxW && size > 20) { size -= 2; ctx.font = `700 ${size}px system-ui, sans-serif`; }
    ctx.fillText(text, 148, H / 2 - 2);
    ctx.globalAlpha = 0.5; ctx.fillRect(148, H / 2 + size / 2 + 6, Math.min(maxW, ctx.measureText(text).width), 3); ctx.globalAlpha = 1;
  });
}

export function drawClock(ctx: Ctx, iso: Iso, x: number, t: number) {
  faceY(ctx, iso, x - 0.4, 0, 3.0, () => {
    ellipse(ctx, 40, 40, 38, 38, "#2b2f36"); ellipse(ctx, 40, 40, 33, 33, "#f4f1ea");
    ctx.strokeStyle = "#1f2421"; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(40 + Math.cos(a) * 27, 40 + Math.sin(a) * 27); ctx.lineTo(40 + Math.cos(a) * 31, 40 + Math.sin(a) * 31); ctx.stroke(); }
    const d = new Date(t > 1e11 ? t : Date.now());
    const hr = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2 - Math.PI / 2;
    const mn = (d.getMinutes() + d.getSeconds() / 60) / 60 * Math.PI * 2 - Math.PI / 2;
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(40 + Math.cos(hr) * 17, 40 + Math.sin(hr) * 17); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(40 + Math.cos(mn) * 25, 40 + Math.sin(mn) * 25); ctx.stroke();
    ellipse(ctx, 40, 40, 3.5, 3.5, "#b8433a");
    ctx.lineCap = "butt";
  });
}

type PosterKind = 0 | 1 | 2;
function posterArt(ctx: Ctx, w: number, h: number, kind: PosterKind, s: OfficeStyle) {
  fillRound(ctx, -6, -6, w + 12, h + 12, 4, "#f4f1ea");
  fillRound(ctx, -10, -10, w + 20, h + 20, 6, "rgba(0,0,0,.0)");
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (kind === 0) { g.addColorStop(0, "#f7c873"); g.addColorStop(1, "#e8805a"); }
  else if (kind === 1) { g.addColorStop(0, "#8fb8de"); g.addColorStop(1, "#e3effa"); }
  else { g.addColorStop(0, shade(s.sign, 0.1)); g.addColorStop(1, shade(s.sign, -0.15)); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (kind === 0) { ellipse(ctx, w * 0.5, h * 0.42, w * 0.2, w * 0.2, "#fff2c9"); ctx.fillStyle = "#3b4a64"; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.35, h * 0.62); ctx.lineTo(w * 0.62, h); ctx.fill(); ctx.fillStyle = "#26334a"; ctx.beginPath(); ctx.moveTo(w * 0.3, h); ctx.lineTo(w * 0.72, h * 0.55); ctx.lineTo(w, h); ctx.fill(); }
  else if (kind === 1) { ctx.fillStyle = "#ffffff"; for (let i = 0; i < 4; i++) ellipse(ctx, w * (0.2 + i * 0.2), h * (0.3 + (i % 2) * 0.2), w * 0.14, w * 0.07, "#ffffffcc"); ctx.fillStyle = "#4f8a54"; ctx.fillRect(0, h * 0.78, w, h * 0.22); }
  else { ctx.strokeStyle = "#ffffffcc"; ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, 10 + i * 12, 0, Math.PI * 2); ctx.stroke(); } }
}

export function drawPosterBack(ctx: Ctx, iso: Iso, s: OfficeStyle, x: number, kind: PosterKind) {
  faceY(ctx, iso, x, 0, 2.6, () => posterArt(ctx, 70, 100, kind, s));
}

export function drawLeftWallDecor(ctx: Ctx, iso: Iso, s: OfficeStyle, L: Layout, decor: boolean, t: number) {
  // door
  const yHi = L.rows - 2.0;
  faceX(ctx, iso, 0, yHi, 2.35, () => {
    fillRound(ctx, -9, -9, 158, 250, 3, shade(s.wallTrim, -0.1));
    fillRound(ctx, 0, 0, 140, 238, 2, shade("#8a6a4a", -0.02));
    ctx.fillStyle = "#7a5a3c"; ctx.fillRect(14, 16, 50, 92); ctx.fillRect(76, 16, 50, 92); ctx.fillRect(14, 124, 50, 94); ctx.fillRect(76, 124, 50, 94);
    ellipse(ctx, 120, 130, 6, 6, "#d8c27a");
  });
  if (!decor) return;
  // kanban board
  const yb = 5.6, bw = 3.1;
  faceX(ctx, iso, 0, yb, 2.4, () => {
    const W = bw * 100, H = 130;
    fillRound(ctx, -6, -6, W + 12, H + 12, 4, "#9a9a9a");
    ctx.fillStyle = "#f7f6f1"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#c8c6bd"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W / 3, 8); ctx.lineTo(W / 3, H - 8); ctx.moveTo((W * 2) / 3, 8); ctx.lineTo((W * 2) / 3, H - 8); ctx.stroke();
    ctx.fillStyle = "#6b7280"; ctx.font = "600 13px system-ui, sans-serif"; ctx.textAlign = "center";
    ["TO DO", "DOING", "DONE"].forEach((l, i) => ctx.fillText(l, W / 6 + (i * W) / 3, 17));
    const notes = ["#f6d860", "#7fd1a0", "#f19ab0", "#8fc3f0"];
    for (let i = 0; i < 9; i++) { const col = i < 4 ? 0 : i < 6 ? 1 : 2; const row = i < 4 ? i : i < 6 ? i - 4 : i - 6; ctx.fillStyle = notes[i % 4]; ctx.fillRect(10 + col * (W / 3), 28 + row * 24, 56, 18); }
    if (Math.floor(t / 900) % 2) { ctx.fillStyle = "#2b2f36"; ctx.fillRect(W - 22, H - 14, 2, 8); }
    ctx.fillStyle = "#d0d0d0"; ctx.fillRect(W - 80, H + 6, 70, 5);
  });
  // posters
  faceX(ctx, iso, 0, 9.4, 2.6, () => posterArt(ctx, 70, 100, 1, s));
  faceX(ctx, iso, 0, 8.0, 2.4, () => posterArt(ctx, 70, 80, 2, s));
}

/* ---------------------------------------------------------------- desks */

const GLOW: Partial<Record<AgentState, string>> = { error: "#ff6b5e", running: "#6ee7b7", reviewing: "#c4a7ff", waiting: "#ffd479" };

export function drawDesk(ctx: Ctx, iso: Iso, s: OfficeStyle, d: Desk, owner: { state: AgentState; role: Role } | null, seated: boolean, plants: boolean, t: number) {
  const { x, y } = d;
  const working = !!owner && owner.state !== "idle";
  if (!seated) {
    const [cx, cy] = iso.p(d.seat.x + 0.08, d.seat.y + 0.25);
    drawChair(ctx, cx, cy, iso.k, "#5d6877");
  }
  // legs and drawer unit
  const leg = shade(s.deskEdge, -0.05);
  box(ctx, iso, x + 0.1, y + 0.08, 0, 0.09, 0.84, 0.7, leg);
  box(ctx, iso, x + 1.81, y + 0.08, 0, 0.09, 0.84, 0.7, leg);
  box(ctx, iso, x + 1.15, y + 0.1, 0.06, 0.62, 0.8, 0.62, s.desk);
  faceY(ctx, iso, x + 1.15, y + 0.9, 0.68, () => {
    ctx.strokeStyle = shade(s.desk, -0.18); ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { ctx.strokeRect(5, 4 + i * 18, 52, 15); }
    ctx.fillStyle = shade(s.desk, -0.3);
    for (let i = 0; i < 3; i++) ctx.fillRect(25, 9 + i * 18, 12, 2.5);
  });
  // top
  box(ctx, iso, x, y, 0.7, 2, 1, 0.07, { top: s.deskTop, left: s.desk, right: s.deskEdge });
  // light spill from the screen
  if (working) {
    ctx.globalAlpha = 0.2 + 0.08 * Math.sin(t / 220);
    quad(ctx, iso, x + 0.3, y + 0.05, 1.4, 0.45, 0.78, GLOW[owner!.state] ?? "#9fd3ff");
    ctx.globalAlpha = 1;
  }
  // keyboard, mouse
  box(ctx, iso, x + 0.62, y + 0.12, 0.77, 0.8, 0.26, 0.03, { top: "#4a4f58", left: "#2c3038", right: "#23262c" });
  box(ctx, iso, x + 1.62, y + 0.2, 0.77, 0.11, 0.16, 0.04, "#2c3038");
  // monitor (back towards us)
  box(ctx, iso, x + 0.78, y + 0.46, 0.77, 0.44, 0.22, 0.02, "#2b2f36");
  box(ctx, iso, x + 0.93, y + 0.52, 0.79, 0.14, 0.12, 0.16, "#2b2f36");
  box(ctx, iso, x + 0.44, y + 0.58, 0.95, 1.12, 0.06, 0.66, { top: "#3a3f48", left: "#262a31", right: "#1e2127" });
  const [lx, ly] = iso.p(x + 1.0, y + 0.64, 1.28);
  ellipse(ctx, lx, ly, iso.k * 0.07, iso.k * 0.05, "#586070");
  if (working) { ctx.globalAlpha = 0.35; poly(ctx, [iso.p(x + 0.44, y + 0.58, 1.61), iso.p(x + 0.44, y + 0.52, 1.61), iso.p(x + 1.56, y + 0.52, 1.61), iso.p(x + 1.56, y + 0.58, 1.61)], GLOW[owner!.state] ?? "#9fd3ff"); ctx.globalAlpha = 1; }
  // role props
  const role = owner?.role;
  if (role === "planner") {
    box(ctx, iso, x + 0.16, y + 0.3, 0.77, 0.34, 0.44, 0.02, "#f4f1ea");
    box(ctx, iso, x + 0.2, y + 0.34, 0.79, 0.06, 0.3, 0.015, "#3f7fd0");
    for (const [i, c] of ["#f6d860", "#f19ab0", "#7fd1a0"].entries()) box(ctx, iso, x + 0.2 + i * 0.1, y + 0.72, 0.77, 0.08, 0.08, 0.015 + i * 0.012, c);
  } else if (role === "reviewer") {
    box(ctx, iso, x + 0.14, y + 0.3, 0.77, 0.38, 0.5, 0.05, "#f4f1ea");
    box(ctx, iso, x + 0.17, y + 0.34, 0.82, 0.32, 0.42, 0.04, "#e8e4d8");
    box(ctx, iso, x + 0.2, y + 0.38, 0.86, 0.28, 0.36, 0.02, "#f4f1ea");
    const [mx, my] = iso.p(x + 1.78, y + 0.5, 0.84);
    ctx.strokeStyle = "#8a6a3a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + iso.k * 0.14, my + iso.k * 0.1); ctx.stroke();
    ctx.strokeStyle = "#c9cfd6"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(mx - 1, my - 1, iso.k * 0.1, 0, Math.PI * 2); ctx.stroke();
  } else {
    // mug (+ a small plant) for developers
    const [mx, my] = iso.p(x + 0.22, y + 0.55, 0.77);
    fillRound(ctx, mx - iso.k * 0.08, my - iso.k * 0.2, iso.k * 0.16, iso.k * 0.2, 2, "#f4f1ea");
    if (working && Math.floor(t / 450) % 2) { ctx.globalAlpha = 0.5; ctx.fillStyle = "#fff"; ctx.fillRect(mx - 1, my - iso.k * 0.36, 1.6, iso.k * 0.12); ctx.globalAlpha = 1; }
    if (plants && role) {
      const [px, py] = iso.p(x + 1.7, y + 0.7, 0.77);
      fillRound(ctx, px - iso.k * 0.09, py - iso.k * 0.12, iso.k * 0.18, iso.k * 0.12, 2, s.pot);
      ellipse(ctx, px - 2, py - iso.k * 0.22, iso.k * 0.07, iso.k * 0.12, s.plant);
      ellipse(ctx, px + 2, py - iso.k * 0.25, iso.k * 0.06, iso.k * 0.12, s.plantDark);
    }
  }
}

/* ---------------------------------------------------------------- lounge furniture */

export function drawSofa(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"]["sofa"]) {
  const { x, y, w, d } = f;
  const dark = s.sofaDark;
  box(ctx, iso, x, y, 0, w, d, 0.4, dark);
  for (let i = 0; i < 3; i++) box(ctx, iso, x + 0.14 + i * ((w - 0.28) / 3), y + 0.04, 0.4, (w - 0.28) / 3 - 0.02, 0.66, 0.14, { top: shade(s.sofa, 0.08), left: s.sofa, right: shade(s.sofa, -0.1) });
  box(ctx, iso, x + 0.08, y + d - 0.34, 0.4, w - 0.16, 0.34, 0.62, { top: shade(s.sofa, 0.12), left: s.sofa, right: shade(s.sofa, -0.1) });
  box(ctx, iso, x, y, 0.4, 0.16, d, 0.34, { top: shade(dark, 0.12), left: dark, right: shade(dark, -0.12) });
  box(ctx, iso, x + w - 0.16, y, 0.4, 0.16, d, 0.34, { top: shade(dark, 0.12), left: dark, right: shade(dark, -0.12) });
  // cushions on the back
  box(ctx, iso, x + 0.34, y + d - 0.36, 0.7, 0.32, 0.12, 0.26, shade(s.sign, 0.1));
  box(ctx, iso, x + w - 0.7, y + d - 0.36, 0.7, 0.32, 0.12, 0.26, "#e8c46a");
}

export function drawCoffeeTable(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"]["table"]) {
  const { x, y, w, d } = f;
  for (const [dx, dy] of [[0.08, 0.08], [w - 0.16, 0.08], [0.08, d - 0.16], [w - 0.16, d - 0.16]]) box(ctx, iso, x + dx, y + dy, 0, 0.08, 0.08, 0.38, "#2b2b2b");
  box(ctx, iso, x, y, 0.38, w, d, 0.07, { top: shade(s.deskTop, 0.02), left: s.desk, right: s.deskEdge });
  box(ctx, iso, x + 0.2, y + 0.2, 0.45, 0.42, 0.3, 0.02, "#c9cfd6");
  box(ctx, iso, x + 0.24, y + 0.24, 0.47, 0.34, 0.12, 0.012, "#d0573f");
  const [cx, cy] = iso.p(x + w - 0.4, y + 0.4, 0.45);
  fillRound(ctx, cx - iso.k * 0.08, cy - iso.k * 0.18, iso.k * 0.16, iso.k * 0.18, 2, "#f4f1ea");
}

export function drawCounter(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"]["counter"], t: number) {
  const { x, y, w, d } = f;
  box(ctx, iso, x, y, 0, w, d, 0.88, { top: s.desk, left: shade(s.desk, -0.04), right: shade(s.desk, -0.17) });
  faceY(ctx, iso, x, y + d, 0.88, () => {
    ctx.strokeStyle = shade(s.desk, -0.2); ctx.lineWidth = 1.6;
    for (let i = 0; i < 2; i++) ctx.strokeRect(8 + i * 98, 8, 88, 72);
    ctx.fillStyle = shade(s.desk, -0.35); ctx.fillRect(86, 38, 3, 14); ctx.fillRect(108, 38, 3, 14);
  });
  box(ctx, iso, x - 0.04, y - 0.02, 0.88, w + 0.08, d + 0.06, 0.07, { top: shade(s.deskTop, 0.05), left: s.deskTop, right: s.deskEdge });
  // machine
  const mx = x + 0.25, my = y + 0.12, mz = 0.95;
  box(ctx, iso, mx, my, mz, 0.72, 0.52, 0.66, { top: "#4a5058", left: "#3a3f45", right: "#2d3136" });
  faceY(ctx, iso, mx, my + 0.52, mz + 0.66, () => {
    fillRound(ctx, 6, 6, 60, 20, 3, "#b8433a");
    ctx.fillStyle = "#f4f1ea"; ctx.fillRect(10, 11, 8, 3); ctx.fillRect(22, 11, 8, 3);
    ellipse(ctx, 50, 16, 4, 4, Math.floor(t / 600) % 2 ? "#6ee7b7" : "#2e8f6c");
    ctx.fillStyle = "#1c1f23"; ctx.fillRect(14, 34, 44, 26);
    ctx.fillStyle = "#8a8f96"; ctx.fillRect(34, 28, 5, 12);
    ctx.fillStyle = "#f4f1ea"; fillRound(ctx, 28, 46, 18, 16, 3, "#f4f1ea");
    ctx.fillStyle = "#6b4426"; ctx.fillRect(30, 49, 14, 5 + Math.sin(t / 700) * 1);
  });
  // steam
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 1200 + i / 3) % 1);
    const [sx, sy] = iso.p(mx + 0.4, my + 0.5, mz + 0.2 + ph * 0.7);
    ellipse(ctx, sx + Math.sin(ph * 6 + i) * 3, sy, 2.4 + ph * 2, 3.2 + ph * 2, "#fff");
  }
  ctx.globalAlpha = 1;
  // cups and a stack of mugs
  for (let i = 0; i < 3; i++) box(ctx, iso, x + 1.2 + i * 0.2, y + 0.3, 0.95, 0.12, 0.12, 0.13, "#f4f1ea");
  box(ctx, iso, x + 1.72, y + 0.2, 0.95, 0.2, 0.2, 0.05, "#c98b2e");
}

export function drawShelf(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"]["shelf"]) {
  const { x, y, w, d } = f;
  box(ctx, iso, x, y, 0, w, d, 2.0, { top: shade(s.desk, 0.1), left: shade(s.desk, -0.06), right: shade(s.desk, -0.2) });
  faceY(ctx, iso, x, y + d, 2.0, () => {
    const W = w * 100, H = 200;
    ctx.fillStyle = shade(s.desk, -0.34); ctx.fillRect(5, 5, W - 10, H - 10);
    const cols = ["#d0573f", "#3f7fd0", "#4f9a5a", "#c98b2e", "#8a5bc8", "#e8e0d0", "#2f8f8a", "#c84f8a"];
    for (let r = 0; r < 4; r++) {
      const sy = 8 + r * 48;
      let bx = 10;
      let i = r * 11;
      while (bx < W - 26) {
        const bw = 8 + rnd(i) * 7, bh = 26 + rnd(i + 90) * 15;
        if (r === 1 && bx > W * 0.55 && bx < W * 0.55 + 22) { ellipse(ctx, bx + 8, sy + 34, 7, 8, "#d9d2c3"); ctx.fillStyle = s.plant; ctx.fillRect(bx + 5, sy + 14, 6, 14); bx += 22; i++; continue; }
        ctx.fillStyle = cols[Math.floor(rnd(i + 3) * cols.length)]; ctx.fillRect(bx, sy + 44 - bh, bw, bh);
        ctx.fillStyle = "rgba(255,255,255,.3)"; ctx.fillRect(bx + 1, sy + 44 - bh + 4, bw - 2, 2);
        bx += bw + 1; i++;
      }
      ctx.fillStyle = shade(s.desk, -0.12); ctx.fillRect(5, sy + 44, W - 10, 4);
    }
  });
}

export function drawLamp(ctx: Ctx, iso: Iso, s: OfficeStyle, p: { x: number; y: number }, dark: boolean) {
  const [bx, by] = iso.p(p.x, p.y);
  const k = iso.k;
  if (dark) {
    const g = ctx.createRadialGradient(bx, by - k * 1.9, 4, bx, by - k * 1.5, k * 2.6);
    g.addColorStop(0, `${s.lamp}66`); g.addColorStop(1, `${s.lamp}00`);
    ctx.fillStyle = g; ctx.fillRect(bx - k * 3, by - k * 4.5, k * 6, k * 6);
  }
  ellipse(ctx, bx, by, k * 0.3, k * 0.12, "#2b2b2b");
  ctx.strokeStyle = "#2b2b2b"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - k * 1.7); ctx.stroke();
  poly(ctx, [[bx - k * 0.34, by - k * 1.55], [bx + k * 0.34, by - k * 1.55], [bx + k * 0.22, by - k * 2.0], [bx - k * 0.22, by - k * 2.0]], s.lamp, shade(s.lamp, -0.25));
  ellipse(ctx, bx, by - k * 2.0, k * 0.22, k * 0.07, shade(s.lamp, 0.15));
}

export function drawPlant(ctx: Ctx, iso: Iso, s: OfficeStyle, x: number, y: number, big: boolean, t: number) {
  const [bx, by] = iso.p(x, y);
  const k = iso.k;
  const seed = Math.floor(x * 7 + y * 13);
  const pw = k * (big ? 0.34 : 0.26), ph = k * (big ? 0.55 : 0.42);
  ctx.globalAlpha = 0.18; ellipse(ctx, bx + 4, by + 2, pw * 1.5, pw * 0.7, "#000"); ctx.globalAlpha = 1;
  // pot
  ctx.fillStyle = shade(s.pot, -0.12);
  ctx.beginPath(); ctx.moveTo(bx - pw, by - ph); ctx.lineTo(bx + pw, by - ph); ctx.lineTo(bx + pw * 0.72, by); ctx.lineTo(bx - pw * 0.72, by); ctx.closePath(); ctx.fill();
  ellipse(ctx, bx, by, pw * 0.72, pw * 0.3, shade(s.pot, -0.12));
  ctx.fillStyle = s.pot;
  ctx.beginPath(); ctx.moveTo(bx - pw, by - ph); ctx.lineTo(bx, by - ph); ctx.lineTo(bx, by + pw * 0.3); ctx.lineTo(bx - pw * 0.72, by); ctx.closePath(); ctx.fill();
  ellipse(ctx, bx, by - ph, pw, pw * 0.38, shade(s.pot, 0.08));
  ellipse(ctx, bx, by - ph, pw * 0.8, pw * 0.28, "#4a3a2a");
  // leaves
  const n = big ? 11 : 7, hgt = k * (big ? 2.0 : 1.0);
  for (let i = 0; i < n; i++) {
    const a = ((i / n) * 2 - 1) * (big ? 1.15 : 1.35) + (rnd(seed + i) - 0.5) * 0.3;
    const len = hgt * (0.5 + rnd(seed + i + 20) * 0.5) * (1 - Math.abs(a) * 0.18);
    const sway = Math.sin(t / 1100 + i + x) * k * 0.035;
    const x0 = bx, y0 = by - ph;
    const x1 = x0 + Math.sin(a) * len * 0.85 + sway, y1 = y0 - Math.cos(a) * len;
    const lw = k * (big ? 0.2 : 0.14);
    const nx = Math.cos(a), ny = Math.sin(a);
    ctx.fillStyle = i % 2 ? s.plant : s.plantDark;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + nx * lw * 1.6, (y0 + y1) / 2 + ny * lw * 1.6, x1, y1);
    ctx.quadraticCurveTo((x0 + x1) / 2 - nx * lw * 1.6, (y0 + y1) / 2 - ny * lw * 1.6, x0, y0);
    ctx.fill();
    ctx.strokeStyle = shade(i % 2 ? s.plant : s.plantDark, 0.12); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
}

/* ---------------------------------------------------------------- TV and games */

export function drawTv(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"], gaming: boolean, t: number) {
  const tx = f.tv.x + 0.3;
  // console on a low stand
  box(ctx, iso, f.tv.x, 0.02, 0, f.tv.w, 0.46, 0.46, { top: shade(s.desk, 0.05), left: shade(s.desk, -0.12), right: shade(s.desk, -0.25) });
  box(ctx, iso, f.tv.x + 0.3, 0.1, 0.46, 0.5, 0.26, 0.07, "#23262c");
  const [lx, ly] = iso.p(f.tv.x + 0.6, 0.37, 0.52);
  ellipse(ctx, lx, ly, 1.8, 1.4, gaming ? "#6ee7b7" : "#d0573f");
  faceY(ctx, iso, tx, 0, 2.7, () => {
    const W = 240, H = 135;
    ctx.fillStyle = "rgba(0,0,0,.18)"; fillRound(ctx, 4, 6, W + 12, H + 12, 6, "rgba(0,0,0,.18)");
    fillRound(ctx, -6, -6, W + 12, H + 12, 5, "#14161a");
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (gaming) {
      ctx.fillStyle = "#0b1a2a"; ctx.fillRect(0, 0, W, H);
      const bx = 14 + Math.abs(((t / 7) % (2 * (W - 28))) - (W - 28));
      const by = 8 + Math.abs(((t / 11) % (2 * (H - 16))) - (H - 16));
      ctx.fillStyle = "#ffffff44";
      for (let y = 4; y < H; y += 14) ctx.fillRect(W / 2 - 1.5, y, 3, 8);
      ctx.fillStyle = "#6ee7b7"; ctx.fillRect(10, Math.min(H - 34, Math.max(2, by - 16)), 7, 32);
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(W - 17, Math.min(H - 34, Math.max(2, by - 16 + Math.sin(t / 300) * 10)), 7, 32);
      ctx.fillStyle = "#fff"; ctx.fillRect(bx, by, 8, 8);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#1d2430"); g.addColorStop(1, "#2a3446");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const o = (t / 40) % (W + 80);
      ctx.fillStyle = `${s.sign}`; fillRound(ctx, o - 60, H / 2 - 12, 56, 24, 6, s.sign);
      ctx.fillStyle = s.signText; ctx.font = "700 14px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("ZZZ", o - 32, H / 2);
    }
    ctx.globalAlpha = 0.08; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.5, 0); ctx.lineTo(W * 0.2, H); ctx.lineTo(0, H); ctx.fill();
    ctx.restore();
  });
}

const ALIEN_A = ["..###..", ".#####.", "##.#.##", "#######", ".#...#."];
const ALIEN_A2 = ["..###..", ".#####.", "##.#.##", "#######", "#.....#"];
const ALIEN_B = ["...#...", "..###..", ".#####.", "#.###.#", "..#.#.."];
const ALIEN_B2 = ["...#...", "..###..", ".#####.", "#.###.#", ".#...#."];

function sprite(ctx: Ctx, rows: string[], x: number, y: number, c: number, color: string) {
  ctx.fillStyle = color;
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "#") ctx.fillRect(x + i * c, y + j * c, c + 0.15, c + 0.15); });
}

/** A little invaders-style match. Pure function of time, so it loops forever. */
function invaders(ctx: Ctx, W: number, H: number, t: number) {
  const CYCLE = 26000;
  const cyc = t % CYCLE, round = Math.floor(t / CYCLE);
  ctx.fillStyle = "#06130d"; ctx.fillRect(0, 0, W, H);
  const c = 1.45;
  const ax = Math.sin(t / 1700) * 7, step = Math.floor((t / 900) % 2);
  const dropped = Math.floor(cyc / 6500) * 3;
  const total = 15;
  const killed = Math.min(total - 2, Math.floor((cyc / CYCLE) * total * 1.0));
  const order = Array.from({ length: total }, (_, i) => (i * 7 + round * 5) % total);
  const dead = new Set(order.slice(0, killed));
  for (let r = 0; r < 3; r++) for (let col = 0; col < 5; col++) {
    const idx = r * 5 + col;
    if (dead.has(idx)) continue;
    const spr = r === 0 ? (step ? ALIEN_B : ALIEN_B2) : step ? ALIEN_A : ALIEN_A2;
    sprite(ctx, spr, 4 + col * 12.5 + ax, 12 + r * 9.5 + dropped * 0.5, c, r === 0 ? "#ff7ad9" : r === 1 ? "#7affc9" : "#ffe27a");
  }
  // shields
  for (let i = 0; i < 3; i++) { ctx.fillStyle = "#2f9e5a"; ctx.fillRect(10 + i * 22, H - 17, 11, 3.5); ctx.fillRect(11.5 + i * 22, H - 20, 8, 3.5); }
  // ship and bullets
  const shipX = 35 + Math.sin(t / 900) * 26;
  ctx.fillStyle = "#6ee7ff"; ctx.fillRect(shipX - 5, H - 9, 10, 3); ctx.fillRect(shipX - 1.2, H - 12, 2.4, 3);
  const bt = (t % 650) / 650;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(shipX - 0.6 + (Math.sin((t - bt * 650) / 900) - Math.sin(t / 900)) * 26, H - 12 - bt * (H - 24), 1.3, 4.5);
  const et = (t % 1400) / 1400;
  ctx.fillStyle = "#ff6b6b"; ctx.fillRect(14 + ((Math.floor(t / 1400) * 17) % 44) + ax, 26 + et * (H - 40), 1.3, 4.5);
  // hud
  ctx.fillStyle = "#e5ffe9"; ctx.font = "600 5.2px monospace"; ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillText(`SCORE ${String(killed * 30 + round * 100).padStart(4, "0")}`, 2, 1.2);
  ctx.textAlign = "right"; ctx.fillText("♥♥♥", W - 2, 1.2);
  ctx.globalAlpha = 0.1; ctx.fillStyle = "#fff";
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 0.8);
  ctx.globalAlpha = 1;
}

export function drawArcade(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"]["arcade"], t: number) {
  const { x, y, w, d } = f;
  const body = "#2b2f52", accent = s.sign === "#2f6f6a" ? "#ff5fa2" : s.sign;
  box(ctx, iso, x, y, 0, w, d, 0.92, { top: shade(body, 0.1), left: body, right: shade(body, -0.14) });
  // side art (the face towards +y)
  faceY(ctx, iso, x, y + d, 0.92, () => {
    ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(0, 92); ctx.lineTo(30, 20); ctx.lineTo(46, 20); ctx.lineTo(16, 92); ctx.fill();
    ctx.fillStyle = "#ffd479"; ctx.beginPath(); ctx.moveTo(26, 92); ctx.lineTo(56, 20); ctx.lineTo(62, 20); ctx.lineTo(32, 92); ctx.fill();
  });
  const fz = x + w - 0.08;
  // control deck
  box(ctx, iso, fz, y + 0.05, 0.86, 0.26, d - 0.1, 0.1, { top: "#4a4f7a", left: "#3a3e66", right: "#2a2d4a" });
  const [jx, jy] = iso.p(fz + 0.12, y + 0.3, 0.98);
  ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(jx + Math.sin(t / 140) * 2, jy - iso.k * 0.2); ctx.stroke();
  ellipse(ctx, jx + Math.sin(t / 140) * 2, jy - iso.k * 0.22, iso.k * 0.07, iso.k * 0.06, "#d0402f");
  for (const [i, c] of ["#ffd479", "#6ee7b7", "#ff5fa2"].entries()) { const [bx, by] = iso.p(fz + 0.13, y + 0.52 + i * 0.12, 0.98); ellipse(ctx, bx, by, iso.k * 0.04, iso.k * 0.03, c); }
  // upper part with the screen
  box(ctx, iso, x, y, 0.92, w - 0.08, d, 0.88, { top: shade(body, 0.1), left: shade(body, 0.02), right: shade(body, -0.1) });
  faceX(ctx, iso, fz, y + d, 1.6, () => {
    const W = d * 100, H = 66;
    ctx.fillStyle = "#0a0a10"; ctx.fillRect(0, 0, W, 74);
    ctx.save(); ctx.translate(10, 4); ctx.beginPath(); ctx.rect(0, 0, W - 20, H); ctx.clip();
    const sx = (W - 20) / 72;
    ctx.scale(sx, sx); invaders(ctx, 72, H / sx, t);
    ctx.restore();
  });
  // marquee
  box(ctx, iso, x, y, 1.8, w, d, 0.2, { top: shade(accent, 0.1), left: shade(accent, -0.05), right: shade(accent, -0.18) });
  faceX(ctx, iso, x + w, y + d, 2.0, () => {
    const W = d * 100;
    ctx.fillStyle = "#17142b"; ctx.fillRect(0, 0, W, 20);
    ctx.fillStyle = Math.floor(t / 400) % 2 ? "#ffd479" : "#ff5fa2"; ctx.font = "800 15px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("INVADERS", W / 2, 11);
  });
}

const REEL: ("seven" | "cherry" | "lemon" | "bar" | "bell" | "gem")[] = ["seven", "cherry", "bar", "lemon", "bell", "gem", "cherry", "lemon"];

function reelSymbol(ctx: Ctx, kind: (typeof REEL)[number], cx: number, cy: number, r: number) {
  switch (kind) {
    case "seven": ctx.fillStyle = "#e0312b"; ctx.font = `900 ${r * 2.3}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("7", cx, cy + 1); break;
    case "cherry": ellipse(ctx, cx - r * 0.45, cy + r * 0.3, r * 0.5, r * 0.5, "#d92b3a"); ellipse(ctx, cx + r * 0.45, cy + r * 0.4, r * 0.5, r * 0.5, "#e8404e"); ctx.strokeStyle = "#3f8a3f"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy); ctx.quadraticCurveTo(cx, cy - r, cx + r * 0.4, cy + r * 0.05); ctx.stroke(); break;
    case "lemon": ellipse(ctx, cx, cy, r * 0.95, r * 0.65, "#f3d33b"); ellipse(ctx, cx - r * 0.2, cy - r * 0.15, r * 0.3, r * 0.15, "#fff3a0"); break;
    case "bar": ctx.fillStyle = "#202020"; ctx.fillRect(cx - r, cy - r * 0.45, r * 2, r * 0.9); ctx.fillStyle = "#f4f1ea"; ctx.fillRect(cx - r * 0.8, cy - r * 0.2, r * 1.6, r * 0.4); break;
    case "bell": ctx.fillStyle = "#f0b72f"; ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, Math.PI, 0); ctx.lineTo(cx + r * 0.9, cy + r * 0.6); ctx.lineTo(cx - r * 0.9, cy + r * 0.6); ctx.closePath(); ctx.fill(); ellipse(ctx, cx, cy + r * 0.75, r * 0.2, r * 0.2, "#c78c1d"); break;
    default: ctx.fillStyle = "#4fc3f7"; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#c9f0ff"; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.3, cy - r * 0.1); ctx.lineTo(cx - r * 0.3, cy - r * 0.1); ctx.closePath(); ctx.fill();
  }
}

export function slotCycle(t: number) { return { c: (t % 6500) / 6500, n: Math.floor(t / 6500) }; }

export function drawSlots(ctx: Ctx, iso: Iso, s: OfficeStyle, f: Layout["lounge"]["slots"], t: number) {
  const { x, y, w, d } = f;
  const { c, n } = slotCycle(t);
  const red = "#b8352e", chrome = "#c9cfd6";
  const win = n % 3 === 0;
  const finals = win ? [0, 0, 0] : [Math.floor(rnd(n * 3 + 1) * 8), Math.floor(rnd(n * 3 + 2) * 8), (Math.floor(rnd(n * 3 + 3) * 8) + 3) % 8];
  box(ctx, iso, x, y, 0, w, d, 0.82, { top: shade("#2b2b30", 0.1), left: "#2b2b30", right: "#1f1f23" });
  box(ctx, iso, x, y, 0.82, w, d, 0.8, { top: shade(red, 0.12), left: red, right: shade(red, -0.16) });
  // lever on the side (face towards +y): swings once at the start of each round
  faceY(ctx, iso, x, y + d, 1.62, () => {
    const pull = c < 0.07 ? c / 0.07 : c < 0.16 ? 1 - (c - 0.07) / 0.09 : 0;
    ctx.fillStyle = shade(red, -0.25); ctx.fillRect(0, 4, 80, 78);
    const px0 = 40, py0 = 76;
    const a = -2.2 + pull * 1.5;
    const ex = px0 + Math.cos(a) * 62, ey = py0 + Math.sin(a) * 62 + 20;
    ctx.strokeStyle = chrome; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(px0, py0 + 20); ctx.lineTo(ex, ey); ctx.stroke(); ctx.lineCap = "butt";
    ellipse(ctx, ex, ey, 8, 8, "#e0312b"); ellipse(ctx, ex - 2, ey - 2, 2.5, 2.5, "#ff9a90");
    ellipse(ctx, px0, py0 + 20, 6, 6, "#8a8f96");
  });
  // reel window on the front face (towards +x)
  faceX(ctx, iso, x + w, y + d, 1.55, () => {
    const W = d * 100;
    ctx.fillStyle = "#1a1a1e"; ctx.fillRect(0, 0, W, 66);
    ctx.fillStyle = chrome; ctx.fillRect(5, 5, W - 10, 56);
    ctx.fillStyle = "#f6f1e0"; ctx.fillRect(8, 8, W - 16, 50);
    const rw = (W - 22) / 3;
    for (let i = 0; i < 3; i++) {
      const rx = 10 + i * (rw + 1);
      ctx.save(); ctx.beginPath(); ctx.rect(rx, 8, rw, 50); ctx.clip();
      const stop = 0.38 + i * 0.12;
      let pos: number;
      if (c < stop) pos = (c * 40 * (1 + i * 0.15)) % 8; else pos = finals[i];
      const base = Math.floor(pos), fr = pos - base;
      for (let j = -1; j <= 2; j++) {
        const idx = ((base + j) % 8 + 8) % 8;
        reelSymbol(ctx, REEL[idx], rx + rw / 2, 33 + (fr - j) * 22, 8.5);
      }
      const g = ctx.createLinearGradient(0, 8, 0, 58); g.addColorStop(0, "rgba(0,0,0,.28)"); g.addColorStop(0.3, "rgba(0,0,0,0)"); g.addColorStop(0.7, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.28)");
      ctx.fillStyle = g; ctx.fillRect(rx, 8, rw, 50);
      ctx.restore();
    }
    ctx.strokeStyle = "#d0402f"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(8, 33); ctx.lineTo(W - 8, 33); ctx.stroke();
    // coin tray
    ctx.fillStyle = "#3a3a40"; ctx.fillRect(14, 74, W - 28, 14);
    if (win && c > 0.62 && c < 0.95) { for (let i = 0; i < 6; i++) ellipse(ctx, 22 + i * 9 + (i % 2) * 2, 80 + (i % 2) * 2, 3.6, 3.6, "#f3d33b"); }
  });
  // marquee with chasing bulbs
  box(ctx, iso, x - 0.02, y - 0.02, 1.62, w + 0.04, d + 0.04, 0.26, { top: shade(red, 0.2), left: shade(red, -0.04), right: shade(red, -0.2) });
  faceX(ctx, iso, x + w + 0.02, y + d + 0.02, 1.88, () => {
    const W = (d + 0.04) * 100;
    ctx.fillStyle = "#2a0d0b"; ctx.fillRect(0, 0, W, 24);
    const fast = win && c > 0.6 && c < 0.95;
    for (let i = 0; i < 6; i++) {
      const on = fast ? Math.floor(t / 90) % 2 === i % 2 : Math.floor(t / 300 + i) % 3 === 0;
      ellipse(ctx, 9 + i * ((W - 18) / 5), 12, 4.2, 4.2, on ? "#ffe27a" : "#6b5a1d");
    }
  });
}

/* ---------------------------------------------------------------- glass rooms */

export function glassSegments(b: Block): { x0: number; y0: number; x1: number; y1: number; front: boolean }[] {
  const out: { x0: number; y0: number; x1: number; y1: number; front: boolean }[] = [];
  if (b.y > 0) for (let x = 0; x < b.w; x++) out.push({ x0: b.x + x, y0: b.y, x1: b.x + x + 1, y1: b.y, front: false });
  if (b.x > 0) for (let y = 0; y < b.h; y++) out.push({ x0: b.x, y0: b.y + y, x1: b.x, y1: b.y + y + 1, front: false });
  for (let x = 0; x < b.w - 1; x++) out.push({ x0: b.x + x, y0: b.y + b.h, x1: b.x + x + 1, y1: b.y + b.h, front: true });
  for (let y = 0; y < b.h; y++) out.push({ x0: b.x + b.w, y0: b.y + y, x1: b.x + b.w, y1: b.y + y + 1, front: true });
  return out;
}

export function drawGlassSegment(ctx: Ctx, iso: Iso, seg: { x0: number; y0: number; x1: number; y1: number }, color: string) {
  const H = 1.95;
  const pts = [iso.p(seg.x0, seg.y0, 0), iso.p(seg.x1, seg.y1, 0), iso.p(seg.x1, seg.y1, H), iso.p(seg.x0, seg.y0, H)] as [number, number][];
  ctx.globalAlpha = 0.17; poly(ctx, pts, "#d8f0ff"); ctx.globalAlpha = 1;
  // reflection streak
  ctx.globalAlpha = 0.16;
  const m = (f: number, z: number) => iso.p(seg.x0 + (seg.x1 - seg.x0) * f, seg.y0 + (seg.y1 - seg.y0) * f, z);
  poly(ctx, [m(0.15, 0.1), m(0.4, 0.1), m(0.85, H - 0.1), m(0.6, H - 0.1)], "#ffffff");
  ctx.globalAlpha = 1;
  poly(ctx, [iso.p(seg.x0, seg.y0, H), iso.p(seg.x1, seg.y1, H)], undefined, color, 2.4);
  poly(ctx, [iso.p(seg.x0, seg.y0, 0.05), iso.p(seg.x1, seg.y1, 0.05)], undefined, shade(color, -0.2), 2.4);
}

export function drawGlassPost(ctx: Ctx, iso: Iso, x: number, y: number, color: string) {
  poly(ctx, [iso.p(x, y, 0), iso.p(x, y, 2.0)], undefined, color, 3.4);
}

export function drawDoor(ctx: Ctx, iso: Iso, b: Block) {
  const hx = b.x + b.w - 1, hy = b.y + b.h;
  const ex = hx, ey = hy - 0.45;
  ctx.globalAlpha = 0.2;
  poly(ctx, [iso.p(hx, hy, 0), iso.p(ex + 0.2, ey, 0), iso.p(ex + 0.2, ey, 1.95), iso.p(hx, hy, 1.95)], "#d8f0ff");
  ctx.globalAlpha = 1;
  poly(ctx, [iso.p(hx, hy, 1.95), iso.p(ex + 0.2, ey, 1.95)], undefined, b.color, 2.4);
  poly(ctx, [iso.p(b.x + b.w - 1, b.y + b.h, 1.98), iso.p(b.x + b.w, b.y + b.h, 1.98)], undefined, b.color, 4);
}

