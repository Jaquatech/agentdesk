import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { drawCharacter } from "../office/draw.ts";
import type { Look } from "../office/palette.ts";

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { width: "min(900px, 100%)" } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="spacer" />
          <button className="btn small" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

/** Small pixel portrait of an agent, drawn with the same code as the office. */
export function Avatar({ look, size = 40 }: { look: Look; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 16, 16);
    ctx.imageSmoothingEnabled = false;
    drawCharacter(ctx, 8, 21, look, "stand", 1);
  }, [look.shirt, look.hair, look.skin, look.hairStyle]);
  return <canvas ref={ref} width={16} height={16} className="avatar" style={{ width: size, height: size }} />;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status s-${status}`}>{status.replace("_", " ")}</span>;
}

export function money(v: number | null | undefined) {
  if (v === null || v === undefined) return "–";
  return `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`;
}

export function ago(iso: string) {
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
