import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field as ShadField, FieldDescription, FieldLabel } from "@/components/ui/field";
import { drawCharacter } from "../office/draw.ts";
import type { Look } from "../office/palette.ts";

const STATUS_TONE: Record<string, string> = {
  building: "border-primary/40 text-primary-text",
  verifying: "border-primary/40 text-primary-text",
  reviewing: "border-primary/40 text-primary-text",
  approved: "border-success/40 text-success",
  merged: "border-success/40 text-success",
  needs_attention: "border-warning/40 text-warning",
  interrupted: "border-warning/40 text-warning",
  failed: "border-destructive/40 text-destructive",
};

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={cn("max-h-[92vh] overflow-auto sm:max-w-[calc(36rem+100px)]", wide && "sm:max-w-[calc(56rem+100px)]")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">{children}</div>
        {footer && <DialogFooter className="sm:justify-end">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** Label, control and optional hint. One control gets the label's id; several are grouped. */
export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null;
  const control = only
    ? cloneElement(only as ReactElement<{ id?: string }>, { id: (only.props as { id?: string }).id ?? id })
    : <div className="flex flex-col gap-2">{children}</div>;
  return (
    <ShadField className={className} data-invalid={undefined}>
      {label != null && label !== "" && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      {control}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </ShadField>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the look changes, not for every new object with the same values
  }, [look.shirt, look.hair, look.skin, look.hairStyle]);
  return <canvas ref={ref} width={16} height={16} className="shrink-0 rounded-lg bg-muted" style={{ width: size, height: size, imageRendering: "pixelated" }} />;
}

export function StatusBadge({ status }: { status: string }) {
  const live = status === "building" || status === "verifying" || status === "reviewing";
  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_TONE[status])}>
      {live && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

export function ToneBadge({ tone, children, title }: { tone?: "good" | "bad" | "wait" | "accent" | ""; children: ReactNode; title?: string }) {
  const cls = tone === "good" ? "border-success/40 text-success"
    : tone === "bad" ? "border-destructive/40 text-destructive"
    : tone === "wait" ? "border-warning/40 text-warning"
    : tone === "accent" ? "border-primary/40 text-primary-text"
    : "";
  return <Badge variant="outline" title={title} className={cls}>{children}</Badge>;
}

/** Push the following footer buttons to the right. */
export function FooterGap() {
  return <span className="mr-auto" />;
}

export function DangerButton(props: React.ComponentProps<typeof Button>) {
  return <Button variant="destructive" {...props} />;
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
