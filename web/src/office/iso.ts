import { shade } from "./draw.ts";

export { shade };
export type Ctx = CanvasRenderingContext2D;

/**
 * Isometric projection (2:1). Grid x runs down-right, grid y runs down-left, z is up.
 * One tile is 2k wide and k tall on screen; one unit of height is UZ·k pixels.
 */
export const HH = 0.5;
export const UZ = 1.1;

export class Iso {
  constructor(public k: number, public ox: number, public oy: number) {}
  x(gx: number, gy: number) { return this.ox + (gx - gy) * this.k; }
  y(gx: number, gy: number, gz = 0) { return this.oy + (gx + gy) * this.k * HH - gz * this.k * UZ; }
  p(gx: number, gy: number, gz = 0): [number, number] { return [this.x(gx, gy), this.y(gx, gy, gz)]; }
}

export function poly(ctx: Ctx, pts: [number, number][], fill?: string | CanvasGradient, stroke?: string, lw = 1) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** Flat quad on the floor (or at height z). */
export function quad(ctx: Ctx, iso: Iso, x: number, y: number, w: number, d: number, z: number, fill: string, stroke?: string) {
  poly(ctx, [iso.p(x, y, z), iso.p(x + w, y, z), iso.p(x + w, y + d, z), iso.p(x, y + d, z)], fill, stroke);
}

export type BoxColors = { top: string; left: string; right: string };
export function boxColors(base: string): BoxColors {
  return { top: shade(base, 0.09), left: base, right: shade(base, -0.13) };
}

/** A box: top, the face towards +y (left on screen) and the face towards +x (right on screen). */
export function box(ctx: Ctx, iso: Iso, x: number, y: number, z: number, w: number, d: number, h: number, base: string | BoxColors, edge?: string) {
  const c = typeof base === "string" ? boxColors(base) : base;
  const x1 = x + w, y1 = y + d, z1 = z + h;
  poly(ctx, [iso.p(x, y1, z), iso.p(x1, y1, z), iso.p(x1, y1, z1), iso.p(x, y1, z1)], c.left, edge);
  poly(ctx, [iso.p(x1, y, z), iso.p(x1, y1, z), iso.p(x1, y1, z1), iso.p(x1, y, z1)], c.right, edge);
  poly(ctx, [iso.p(x, y, z1), iso.p(x1, y, z1), iso.p(x1, y1, z1), iso.p(x, y1, z1)], c.top, edge);
}

export const LOCAL = 100; // local face coordinates: 100 units per tile / per height unit

/**
 * Draw on a vertical plane that faces +y (the "left" faces of boxes, the back wall).
 * Local u runs to the right on screen from grid x0, v runs DOWN from height zTop, both in 1/100 of a tile.
 * So text and images come out the right way up.
 */
export function faceY(ctx: Ctx, iso: Iso, x0: number, y: number, zTop: number, fn: () => void) {
  ctx.save();
  ctx.transform(iso.k / LOCAL, iso.k * HH / LOCAL, 0, iso.k * UZ / LOCAL, iso.x(x0, y), iso.y(x0, y, zTop));
  fn();
  ctx.restore();
}

/**
 * Same for a plane that faces +x (the "right" faces of boxes, the left wall).
 * Local u runs to the right on screen from grid yMax (so towards smaller y).
 */
export function faceX(ctx: Ctx, iso: Iso, x: number, yMax: number, zTop: number, fn: () => void) {
  ctx.save();
  ctx.transform(iso.k / LOCAL, -iso.k * HH / LOCAL, 0, iso.k * UZ / LOCAL, iso.x(x, yMax), iso.y(x, yMax, zTop));
  fn();
  ctx.restore();
}

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function fillRound(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Cheap deterministic pseudo-random in [0,1) from an integer seed. */
export function rnd(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
