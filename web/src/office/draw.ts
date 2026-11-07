import type { Look, OfficeStyle } from "./palette.ts";

/** Pixel drawing helpers. All coordinates are logical pixels; the canvas is scaled up without smoothing. */

export type Ctx = CanvasRenderingContext2D;

export function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export type Pose = "stand" | "walk" | "sit" | "sitBack" | "type";

/**
 * A character, ~10×19 px, anchored at the feet (x = centre, y = bottom).
 * sit: front view seated (legs hidden behind a desk). sitBack: seen from behind (on the sofa).
 */
export function drawCharacter(ctx: Ctx, x: number, y: number, look: Look, pose: Pose, t: number, opts: { facing?: 1 | -1; holding?: "cup" | "pad" } = {}) {
  const left = Math.round(x - 5);
  const skin = look.skin, hair = look.hair, shirt = look.shirt;
  const shirtDark = shade(shirt, -0.12);
  const pants = "#2f3542";
  const back = pose === "sitBack";
  const seated = pose === "sit" || pose === "type" || back;
  const bob = pose === "walk" ? (Math.floor(t / 140) % 2) : pose === "type" ? (Math.floor(t / 180) % 2 === 0 ? 0 : 0) : 0;
  const top = Math.round(y - 19 + (seated ? 5 : 0) - bob);

  // shadow
  if (!seated) { ctx.globalAlpha = 0.18; px(ctx, left + 1, y - 1, 8, 2, "#000"); ctx.globalAlpha = 1; }

  // legs
  if (!seated) {
    const step = pose === "walk" ? Math.floor(t / 140) % 2 : -1;
    px(ctx, left + 2, top + 13, 3, 5 - (step === 0 ? 1 : 0), pants);
    px(ctx, left + 5, top + 13, 3, 5 - (step === 1 ? 1 : 0), pants);
    px(ctx, left + 2, top + 18 - (step === 0 ? 1 : 0), 3, 1, "#1d2129");
    px(ctx, left + 5, top + 18 - (step === 1 ? 1 : 0), 3, 1, "#1d2129");
  } else if (back) {
    px(ctx, left + 2, top + 13, 6, 1, pants);
  }

  // body
  px(ctx, left + 1, top + 7, 8, 6, shirt);
  px(ctx, left + 1, top + 12, 8, 1, shirtDark);
  if (!back) px(ctx, left + 4, top + 7, 2, 1, shade(shirt, 0.15)); // collar

  // arms
  if (pose === "type") {
    const tap = Math.floor(t / 120) % 2;
    px(ctx, left, top + 8, 1, 4, shirtDark);
    px(ctx, left + 9, top + 8, 1, 4, shirtDark);
    px(ctx, left + 1, top + 12 - tap, 2, 1, skin);
    px(ctx, left + 7, top + 11 + tap, 2, 1, skin);
  } else if (back) {
    // holding a game controller in front: arms bent, a hint of the pad
    px(ctx, left, top + 8, 1, 4, shirtDark);
    px(ctx, left + 9, top + 8, 1, 4, shirtDark);
  } else {
    const swing = pose === "walk" ? (Math.floor(t / 140) % 2 ? 1 : -1) : 0;
    px(ctx, left, top + 8 + Math.max(0, swing), 1, 4, shirtDark);
    px(ctx, left + 9, top + 8 + Math.max(0, -swing), 1, 4, shirtDark);
    px(ctx, left, top + 12 + Math.max(0, swing), 1, 1, skin);
    px(ctx, left + 9, top + 12 + Math.max(0, -swing), 1, 1, skin);
    if (opts.holding === "cup") {
      px(ctx, left + 9, top + 10, 3, 3, "#f4f1ea");
      px(ctx, left + 12, top + 11, 1, 1, "#f4f1ea");
      if (Math.floor(t / 400) % 2) px(ctx, left + 10, top + 8, 1, 1, "#ffffffaa");
    }
  }

  // head
  px(ctx, left + 1, top, 8, 7, back ? hair : skin);
  if (!back) {
    // eyes (blink now and then)
    const blink = (Math.floor(t / 100) % 37) === 0;
    const dx = opts.facing === -1 ? -1 : opts.facing === 1 ? 1 : 0;
    if (!blink) {
      px(ctx, left + 3 + dx, top + 3, 1, 2, "#1f1a17");
      px(ctx, left + 6 + dx, top + 3, 1, 2, "#1f1a17");
    } else {
      px(ctx, left + 3 + dx, top + 4, 1, 1, "#1f1a17");
      px(ctx, left + 6 + dx, top + 4, 1, 1, "#1f1a17");
    }
    px(ctx, left + 2, top + 5, 1, 1, shade(skin, -0.06));
  }
  // hair
  drawHair(ctx, left, top, hair, look.hairStyle, back);
}

function drawHair(ctx: Ctx, left: number, top: number, hair: string, style: number, back: boolean) {
  const dark = shade(hair, -0.1);
  switch (style) {
    case 0: // short
      px(ctx, left + 1, top - 1, 8, 3, hair);
      px(ctx, left + 1, top + 2, 1, 2, hair);
      px(ctx, left + 8, top + 2, 1, 2, hair);
      break;
    case 1: // long
      px(ctx, left, top - 1, 10, 3, hair);
      px(ctx, left, top + 2, 2, 7, hair);
      px(ctx, left + 8, top + 2, 2, 7, hair);
      if (back) px(ctx, left + 1, top + 6, 8, 4, dark);
      break;
    case 2: // bun
      px(ctx, left + 3, top - 3, 4, 2, dark);
      px(ctx, left + 1, top - 1, 8, 3, hair);
      px(ctx, left + 1, top + 2, 1, 1, hair);
      px(ctx, left + 8, top + 2, 1, 1, hair);
      break;
    default: // cap
      px(ctx, left + 1, top - 1, 8, 3, "#3b4252");
      px(ctx, left + (back ? 1 : 0), top + 1, back ? 8 : 10, 1, "#2e3440");
      px(ctx, left + 1, top + 2, 1, 2, hair);
      px(ctx, left + 8, top + 2, 1, 2, hair);
  }
}

export function drawPlant(ctx: Ctx, x: number, y: number, s: OfficeStyle, big = false, t = 0) {
  const sway = Math.sin(t / 900 + x) > 0.6 ? 1 : 0;
  const h = big ? 22 : 14;
  px(ctx, x + 2, y - 7, 8, 7, s.pot);
  px(ctx, x + 2, y - 7, 8, 1, shade(s.pot, -0.12));
  px(ctx, x + 4, y - 7 - h + 6, 4, h - 6, s.plantDark);
  px(ctx, x + sway, y - 7 - h + 4, 6, 5, s.plant);
  px(ctx, x + 6 + sway, y - 7 - h + 2, 6, 6, s.plant);
  px(ctx, x + 2, y - 7 - h, 7, 5, shade(s.plant, 0.06));
  if (big) px(ctx, x - 1 + sway, y - 14, 5, 4, s.plantDark);
}
