import { shade } from "./iso.ts";
import { hashString, type OfficeStyle } from "./palette.ts";

/** The company emblem: a generated mark (shape + glyph + colour) or an uploaded image. */

export const LOGO_SHAPES = [
  { key: "circle", label: "Circle" }, { key: "shield", label: "Shield" }, { key: "hex", label: "Hexagon" },
  { key: "square", label: "Rounded square" }, { key: "diamond", label: "Diamond" }, { key: "badge", label: "Badge" },
] as const;
export const LOGO_GLYPHS = [
  { key: "monogram", label: "Initials" }, { key: "bolt", label: "Bolt" }, { key: "peaks", label: "Peaks" },
  { key: "orbit", label: "Orbit" }, { key: "wave", label: "Waves" }, { key: "cube", label: "Cube" }, { key: "leaf", label: "Leaf" },
] as const;
export const LOGO_COLORS = ["#2f6f6a", "#3f7fd0", "#d0573f", "#c98b2e", "#8a5bc8", "#c84f8a", "#4f9a5a", "#3a3f4b"];

export type LogoSpec = {
  name: string; shape: string; glyph: string;
  /** "auto" follows the office style; otherwise a hex colour. */
  color: string;
  image?: CanvasImageSource | null;
};

export function logoSpecFromSettings(s: Record<string, string>, image?: CanvasImageSource | null): LogoSpec {
  return { name: s.company_name || "My Company", shape: s.logo_shape || "circle", glyph: s.logo_glyph || "monogram", color: s.logo_color || "auto", image: image ?? null };
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function logoColor(spec: LogoSpec, style: OfficeStyle): string {
  return /^#[0-9a-f]{6}$/i.test(spec.color) ? spec.color : style.sign;
}

function shapePath(ctx: CanvasRenderingContext2D, shape: string, cx: number, cy: number, r: number) {
  ctx.beginPath();
  switch (shape) {
    case "shield":
      ctx.moveTo(cx - r * 0.86, cy - r * 0.8); ctx.quadraticCurveTo(cx, cy - r * 1.12, cx + r * 0.86, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.86, cy + r * 0.1); ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.66, cx, cy + r * 1.02);
      ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.66, cx - r * 0.86, cy + r * 0.1); break;
    case "hex":
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const x = cx + Math.cos(a) * r * 1.02, y = cy + Math.sin(a) * r * 1.02; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } break;
    case "square": {
      const w = r * 1.7, rr = r * 0.42;
      ctx.moveTo(cx - w / 2 + rr, cy - w / 2); ctx.arcTo(cx + w / 2, cy - w / 2, cx + w / 2, cy + w / 2, rr); ctx.arcTo(cx + w / 2, cy + w / 2, cx - w / 2, cy + w / 2, rr);
      ctx.arcTo(cx - w / 2, cy + w / 2, cx - w / 2, cy - w / 2, rr); ctx.arcTo(cx - w / 2, cy - w / 2, cx + w / 2, cy - w / 2, rr); break;
    }
    case "diamond":
      ctx.moveTo(cx, cy - r * 1.08); ctx.lineTo(cx + r * 1.0, cy); ctx.lineTo(cx, cy + r * 1.08); ctx.lineTo(cx - r * 1.0, cy); break;
    case "badge": // scalloped seal
      for (let i = 0; i < 24; i++) { const a = (i * Math.PI * 2) / 24; const rr = r * (i % 2 ? 0.9 : 1.04); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } break;
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.closePath();
}

function glyph(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, r: number, name: string, ink: string) {
  ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = r * 0.14; ctx.lineCap = "round"; ctx.lineJoin = "round";
  switch (kind) {
    case "bolt":
      ctx.beginPath(); ctx.moveTo(cx + r * 0.1, cy - r * 0.62); ctx.lineTo(cx - r * 0.38, cy + r * 0.1); ctx.lineTo(cx - r * 0.02, cy + r * 0.1); ctx.lineTo(cx - r * 0.12, cy + r * 0.62); ctx.lineTo(cx + r * 0.38, cy - r * 0.1); ctx.lineTo(cx + r * 0.02, cy - r * 0.1); ctx.closePath(); ctx.fill(); break;
    case "peaks":
      ctx.beginPath(); ctx.moveTo(cx - r * 0.62, cy + r * 0.42); ctx.lineTo(cx - r * 0.18, cy - r * 0.25); ctx.lineTo(cx + r * 0.08, cy + r * 0.12); ctx.lineTo(cx + r * 0.3, cy - r * 0.08); ctx.lineTo(cx + r * 0.66, cy + r * 0.42); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.42, r * 0.13, 0, Math.PI * 2); ctx.fill(); break;
    case "orbit":
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = r * 0.1;
      for (const rot of [-0.9, 0.9]) { ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.72, r * 0.26, rot, 0, Math.PI * 2); ctx.stroke(); }
      break;
    case "wave":
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); for (let x = -0.6; x <= 0.6; x += 0.05) { const px = cx + x * r, py = cy + i * r * 0.3 + Math.sin(x * 5.2) * r * 0.1; x === -0.6 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); } break;
    case "cube":
      ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.62); ctx.lineTo(cx + r * 0.54, cy - r * 0.31); ctx.lineTo(cx, cy); ctx.lineTo(cx - r * 0.54, cy - r * 0.31); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.72; ctx.beginPath(); ctx.moveTo(cx - r * 0.54, cy - r * 0.19); ctx.lineTo(cx - 0.05 * r, cy + r * 0.12); ctx.lineTo(cx - 0.05 * r, cy + r * 0.64); ctx.lineTo(cx - r * 0.54, cy + r * 0.34); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(cx + 0.05 * r, cy + r * 0.12); ctx.lineTo(cx + r * 0.54, cy - r * 0.19); ctx.lineTo(cx + r * 0.54, cy + r * 0.34); ctx.lineTo(cx + 0.05 * r, cy + r * 0.64); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; break;
    case "leaf":
      ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy + r * 0.5); ctx.quadraticCurveTo(cx - r * 0.65, cy - r * 0.4, cx + r * 0.5, cy - r * 0.55); ctx.quadraticCurveTo(cx + r * 0.65, cy + r * 0.3, cx - r * 0.45, cy + r * 0.5); ctx.fill();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = "#000"; ctx.lineWidth = r * 0.07; ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy + r * 0.55); ctx.quadraticCurveTo(cx, cy, cx + r * 0.38, cy - r * 0.42); ctx.stroke(); ctx.globalAlpha = 1; break;
    default: {
      const text = initials(name);
      ctx.font = `800 ${r * (text.length > 1 ? 0.92 : 1.15)}px system-ui, "Segoe UI", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy + r * 0.04);
    }
  }
  ctx.lineCap = "butt";
}

/** Draws the emblem centred at (cx, cy) with the given size (its bounding box). */
export function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, spec: LogoSpec, style: OfficeStyle) {
  const r = size / 2;
  if (spec.image) {
    const img = spec.image as HTMLImageElement;
    const iw = img.width || (img as unknown as HTMLCanvasElement).width || 1, ih = img.height || (img as unknown as HTMLCanvasElement).height || 1;
    const f = Math.min(size / iw, size / ih);
    ctx.drawImage(spec.image, cx - (iw * f) / 2, cy - (ih * f) / 2, iw * f, ih * f);
    return;
  }
  const base = logoColor(spec, style);
  const seedShift = (hashString(spec.name) % 7) / 100;
  ctx.save();
  // soft shadow, body gradient, rim, glossy highlight
  shapePath(ctx, spec.shape, cx, cy + r * 0.05, r * 0.94);
  ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fill();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, shade(base, 0.16 + seedShift)); g.addColorStop(1, shade(base, -0.16));
  shapePath(ctx, spec.shape, cx, cy, r * 0.94);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = r * 0.07; ctx.strokeStyle = shade(base, -0.28); ctx.stroke();
  shapePath(ctx, spec.shape, cx, cy, r * 0.94 - r * 0.15);
  ctx.lineWidth = r * 0.04; ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.stroke();
  ctx.save();
  shapePath(ctx, spec.shape, cx, cy, r * 0.94); ctx.clip();
  const gl = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.2, cy + r * 0.2);
  gl.addColorStop(0, "rgba(255,255,255,.34)"); gl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(cx - r * 0.1, cy - r * 0.5, r * 0.95, r * 0.5, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const lum = (parseInt(base.slice(1), 16) >> 16) * 0.3 + ((parseInt(base.slice(1), 16) >> 8) & 255) * 0.59 + (parseInt(base.slice(1), 16) & 255) * 0.11;
  glyph(ctx, spec.glyph, cx, cy, r * 0.82, spec.name, lum > 185 ? "#22262b" : "#ffffff");
  ctx.restore();
}

/** A square canvas with the emblem, for use as a texture (wall sign) or a data URL. */
export function renderLogo(spec: LogoSpec, style: OfficeStyle, px = 256): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  drawLogo(c.getContext("2d")!, px / 2, px / 2, px, spec, style);
  return c;
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Shrinks an uploaded picture to a small PNG data URL so it fits comfortably in the settings. */
export async function shrinkImage(file: File, max = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img) throw new Error("That file is not a picture the browser can read");
    const f = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * f)); c.height = Math.max(1, Math.round(img.height * f));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally { URL.revokeObjectURL(url); }
}
