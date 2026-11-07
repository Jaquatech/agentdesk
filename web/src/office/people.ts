import type { Look } from "./palette.ts";
import { ellipse, fillRound, shade, type Ctx } from "./iso.ts";

export type Dir = "fl" | "fr" | "bl" | "br"; // facing down-left, down-right, up-left, up-right
export type Pose = "stand" | "walk" | "sit" | "type" | "sitBack" | "play" | "pull" | "coffee" | "chat";

export type PersonOpts = {
  pose: Pose; dir: Dir; t: number; mood?: "ok" | "error" | "think";
  chair?: boolean; chairColor?: string;
};

/** Pixel height of a person at tile half-width k (used for hit boxes and labels). */
export const personHeight = (k: number) => k * 1.72;

/**
 * A person, anchored at the feet (x = centre, y = ground). Art is drawn for k = 30 and scaled.
 * Front poses show the face; back poses show the hair, the way people on the sofa or at the arcade are seen.
 */
export function drawPerson(ctx: Ctx, fx: number, fy: number, k: number, look: Look, o: PersonOpts) {
  const s = (k / 30) * 0.96;
  const { pose, t } = o;
  const back = o.dir === "bl" || o.dir === "br" || pose === "sitBack" || pose === "play" || pose === "pull" || pose === "coffee";
  const seated = pose === "sit" || pose === "type" || pose === "sitBack";
  const walking = pose === "walk";
  const phase = Math.floor(t / 150) % 2;
  const bob = walking ? (phase ? -1.2 : 0) : pose === "chat" ? Math.sin(t / 420) * 0.6 : 0;
  const drop = seated ? 4 : 0; // hips sit lower on a chair than they stand
  const lean = o.dir === "fr" || o.dir === "br" ? 1 : -1;

  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(s, s);

  // ground shadow
  if (!seated) { ctx.globalAlpha = 0.2; ellipse(ctx, 0, 0, 11, 4.2, "#000"); ctx.globalAlpha = 1; }

  if (o.chair) drawChairBack(ctx, o.chairColor ?? "#454b55");

  ctx.translate(0, drop + bob);
  const skin = look.skin, shirt = look.shirt, shirtD = shade(shirt, -0.12), pants = "#2f3542";

  // legs
  if (!seated) {
    const a = walking ? (phase ? 3 : -3) : 0;
    fillRound(ctx, -7.5, -19, 6.4, 17 - Math.max(0, a), 2.5, pants);
    fillRound(ctx, 1.1, -19, 6.4, 17 - Math.max(0, -a), 2.5, shade(pants, -0.05));
    fillRound(ctx, -8.2, -3.5 - Math.max(0, a), 7.4, 4, 2, "#1d2129");
    fillRound(ctx, 0.9, -3.5 - Math.max(0, -a), 7.4, 4, 2, "#1d2129");
  } else {
    fillRound(ctx, -8, -19, 16, 6, 3, pants);
  }

  // torso
  fillRound(ctx, -9.5, -37, 19, 19.5, 5, shirt);
  ctx.fillStyle = shirtD;
  ctx.fillRect(2, -35, 7, 16);
  if (!back) {
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.moveTo(-3, -37); ctx.lineTo(3, -37); ctx.lineTo(0, -32.5); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = shade(shirt, 0.06);
    ctx.fillRect(-3, -37, 6, 2);
  }

  // arms
  const swing = walking ? (phase ? 3 : -3) : 0;
  const armL = { x: -14.5, y: -36 }, armR = { x: 10.5, y: -36 };
  if (pose === "type") {
    const tap = Math.floor(t / 110) % 2;
    arm(ctx, armL.x, armL.y, 4.4, 12, shirtD, skin, -2 + (tap ? 0 : -1.5), 9);
    arm(ctx, armR.x, armR.y, 4.4, 12, shirtD, skin, 2 + (tap ? -1.5 : 0), 9);
  } else if (pose === "sit") {
    arm(ctx, armL.x, armL.y, 4.4, 12, shirtD, skin, -2, 9);
    arm(ctx, armR.x, armR.y, 4.4, 12, shirtD, skin, 2, 9);
  } else if (pose === "sitBack") {
    arm(ctx, armL.x, armL.y, 4.4, 14, shirtD, skin, 3, 6);
    arm(ctx, armR.x, armR.y, 4.4, 14, shirtD, skin, -3, 6);
  } else if (pose === "play") {
    const j = Math.sin(t / 90) * 1.6;
    arm(ctx, armL.x, armL.y, 4.4, 15, shirtD, skin, 5 + j, -3);
    arm(ctx, armR.x, armR.y, 4.4, 15, shirtD, skin, -4 - j, -3 + (Math.floor(t / 130) % 2 ? 1 : 0));
  } else if (pose === "pull") {
    const c = (t % 6000) / 6000;
    const pull = c < 0.08 ? c / 0.08 : c < 0.2 ? 1 - (c - 0.08) / 0.12 : 0;
    arm(ctx, armL.x, armL.y, 4.4, 15, shirtD, skin, 2, 2);
    arm(ctx, armR.x, armR.y, 4.4, 15, shirtD, skin, 6, -9 + pull * 14);
  } else if (pose === "coffee") {
    const sip = Math.floor(t / 2200) % 3 === 0 && Math.floor(t / 300) % 2 === 0;
    arm(ctx, armL.x, armL.y, 4.4, 14, shirtD, skin, 1, 4);
    arm(ctx, armR.x, armR.y, 4.4, 14, shirtD, skin, -4, sip ? -14 : -4);
    cup(ctx, 6, sip ? -50 : -30, t);
  } else if (pose === "chat") {
    const wave = Math.floor(t / 2500) % 3 === 0;
    arm(ctx, armL.x, armL.y, 4.4, 15, shirtD, skin, 0, 3);
    arm(ctx, armR.x, armR.y, 4.4, 15, shirtD, skin, wave ? 5 : 0, wave ? -12 + Math.sin(t / 110) * 3 : 3);
  } else {
    arm(ctx, armL.x, armL.y + swing * 0.2, 4.4, 15, shirtD, skin, 0, swing);
    arm(ctx, armR.x, armR.y - swing * 0.2, 4.4, 15, shirtD, skin, 0, -swing);
  }

  // neck + head
  ctx.fillStyle = shade(skin, -0.05);
  ctx.fillRect(-2.6, -40, 5.2, 4);
  const hx = lean * (walking ? 0.8 : 0), hy = -47;
  ellipse(ctx, hx, hy, 9.4, 9, back ? look.hair : skin);
  if (!back) {
    const eyeShift = o.dir === "fr" ? 2.2 : o.dir === "fl" ? -2.2 : 0;
    const blink = Math.floor(t / 90) % 41 === 0;
    const up = o.mood === "think" ? -1.6 : 0;
    ctx.fillStyle = "#231c19";
    if (blink) { ctx.fillRect(hx - 5 + eyeShift, hy + 0.8, 3, 1); ctx.fillRect(hx + 2 + eyeShift, hy + 0.8, 3, 1); }
    else { ellipse(ctx, hx - 3.4 + eyeShift, hy + 0.6 + up, 1.5, 2, "#231c19"); ellipse(ctx, hx + 3.4 + eyeShift, hy + 0.6 + up, 1.5, 2, "#231c19"); }
    ctx.globalAlpha = 0.28; ellipse(ctx, hx - 6 + eyeShift, hy + 4, 2, 1.3, "#e46a6a"); ellipse(ctx, hx + 6 + eyeShift, hy + 4, 2, 1.3, "#e46a6a"); ctx.globalAlpha = 1;
    ctx.strokeStyle = "#8a4a3c"; ctx.lineWidth = 1.2; ctx.beginPath();
    if (o.mood === "error") ctx.arc(hx + eyeShift, hy + 6.8, 2, Math.PI * 1.1, Math.PI * 1.9);
    else ctx.arc(hx + eyeShift, hy + 4.2, 2.6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    if (o.mood === "error") { ctx.strokeStyle = "#231c19"; ctx.beginPath(); ctx.moveTo(hx - 5.5 + eyeShift, hy - 4.4); ctx.lineTo(hx - 1.8 + eyeShift, hy - 3.2); ctx.moveTo(hx + 5.5 + eyeShift, hy - 4.4); ctx.lineTo(hx + 1.8 + eyeShift, hy - 3.2); ctx.stroke(); }
  }
  hair(ctx, hx, hy, look.hair, look.hairStyle, back);
  ctx.restore();
}

function arm(ctx: Ctx, x: number, y: number, w: number, len: number, sleeve: string, skin: string, dx: number, dy: number) {
  // upper arm hangs from the shoulder; the hand ends up at (dx, dy) relative to the straight-down position
  const hx = x + w / 2 + dx, hy = y + len + dy;
  ctx.strokeStyle = sleeve; ctx.lineWidth = w; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x + w / 2, y + 2); ctx.lineTo(hx, hy - 2.5); ctx.stroke();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hx, hy - 1.2, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = "butt";
}

function cup(ctx: Ctx, x: number, y: number, t: number) {
  fillRound(ctx, x - 3, y - 3, 6, 6.5, 1.5, "#f4f1ea");
  ctx.fillStyle = "#8a5a3a"; ctx.fillRect(x - 2.2, y - 2.6, 4.4, 1.2);
  if (Math.floor(t / 400) % 2) { ctx.globalAlpha = 0.5; ctx.fillStyle = "#fff"; ctx.fillRect(x - 0.5, y - 8, 1, 3); ctx.globalAlpha = 1; }
}

function hair(ctx: Ctx, x: number, y: number, c: string, style: number, back: boolean) {
  const dark = shade(c, -0.1);
  ctx.fillStyle = c;
  const cap = () => { ctx.beginPath(); ctx.ellipse(x, y - 1.6, 9.8, 8.2, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); };
  switch (style) {
    case 0: // short
      cap();
      if (!back) { ctx.fillRect(x - 9.8, y - 2, 2.4, 5); ctx.fillRect(x + 7.4, y - 2, 2.4, 5); }
      break;
    case 1: // long
      cap();
      fillRound(ctx, x - 10.4, y - 3, 4, 17, 2, c);
      fillRound(ctx, x + 6.4, y - 3, 4, 17, 2, c);
      if (back) ellipse(ctx, x, y + 2, 9.6, 8, c);
      break;
    case 2: // bun
      cap();
      ellipse(ctx, x, y - 11.5, 4.4, 3.8, dark);
      if (!back) { ctx.fillRect(x - 9.8, y - 2, 2, 4); ctx.fillRect(x + 7.8, y - 2, 2, 4); }
      break;
    default: { // cap with a brim
      const capC = "#3b4252";
      ctx.fillStyle = capC;
      ctx.beginPath(); ctx.ellipse(x, y - 1.6, 10, 8.4, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#2e3440";
      if (back) ctx.fillRect(x - 10, y - 2, 20, 1.6); else fillRound(ctx, x - 10.5, y - 2.2, 21, 2.4, 1, "#2e3440");
      ctx.fillStyle = c;
      if (!back) { ctx.fillRect(x - 9.6, y, 2, 4); ctx.fillRect(x + 7.6, y, 2, 4); }
    }
  }
}

/** An empty office chair standing at (fx, fy). */
export function drawChair(ctx: Ctx, fx: number, fy: number, k: number, color: string) {
  ctx.save(); ctx.translate(fx, fy); ctx.scale((k / 30) * 0.96, (k / 30) * 0.96);
  drawChairBack(ctx, color);
  ctx.restore();
}

function drawChairBack(ctx: Ctx, color: string) {
  // star base and post, seat, rounded backrest with a highlight
  ctx.fillStyle = "#2a2d33";
  ctx.fillRect(-1.2, -12, 2.4, 10);
  ellipse(ctx, 0, -1.5, 10, 3.2, "#2a2d33");
  fillRound(ctx, -11, -41, 22, 27, 6, shade(color, -0.1));
  fillRound(ctx, -9, -39, 18, 22, 5, color);
  ctx.globalAlpha = 0.25; fillRound(ctx, -7, -37, 5, 18, 2.5, "#fff"); ctx.globalAlpha = 1;
  fillRound(ctx, -12.5, -17.5, 25, 7, 3.5, shade(color, 0.06));
}
