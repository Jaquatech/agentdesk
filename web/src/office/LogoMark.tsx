import { useEffect, useRef, useState } from "react";
import { OFFICE_STYLES } from "./palette.ts";
import { drawLogo, loadImage, logoSpecFromSettings } from "./logo.ts";

/** The company emblem as a small canvas (sidebar, Settings preview). Follows the office style and logo settings. */
export function LogoMark({ settings, size = 28 }: { settings: Record<string, string>; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let off = false;
    loadImage(settings.logo_image || "").then((i) => { if (!off) setImg(i); });
    return () => { off = true; };
  }, [settings.logo_image]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawLogo(ctx, c.width / 2, c.height / 2, c.width, logoSpecFromSettings(settings, img), OFFICE_STYLES[settings.office_style] ?? OFFICE_STYLES.nordic);
  }, [settings, img, size]);
  return <canvas ref={ref} style={{ width: size, height: size, flex: "none" }} aria-label="Company logo" />;
}
