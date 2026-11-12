import { FileText, X } from "lucide-react";
import type { AttachmentInfo } from "../api.ts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type Pending = { key: string; name: string; mime: string; size: number; preview?: string; id?: number; error?: string };

const kb = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Files waiting in the composer: thumbnails for images, a chip for other files. */
export function PendingFiles({ files, onRemove }: { files: Pending[]; onRemove: (key: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex w-full flex-wrap items-start gap-2 px-1 pb-2">
      {files.map((f) => (
        <div key={f.key} title={f.error ?? `${f.name} · ${kb(f.size)}`} className={cn("relative flex max-w-60 items-center gap-1.5 rounded-lg border bg-muted py-1 pr-1.5 pl-1 text-xs", f.error && "border-destructive text-destructive")}>
          {f.preview ? <img src={f.preview} alt={f.name} className="size-10 rounded-md object-cover" /> : <FileText />}
          <span className="truncate">{f.error ?? f.name}</span>
          {!f.id && !f.error && <Spinner className="size-3" />}
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onRemove(f.key)} aria-label={`Remove ${f.name}`}><X /></Button>
        </div>
      ))}
    </div>
  );
}

/** Files on a sent message. Images open full size in a new tab. */
export function MessageFiles({ files }: { files: AttachmentInfo[] }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap items-start justify-end gap-2 pt-1.5">
      {files.map((f) => f.mime.startsWith("image/")
        ? <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-muted no-underline" title={f.name}>
            <img src={`/api/attachments/${f.id}`} alt={f.name} className="block max-h-50 max-w-70 object-contain" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).classList.add("att-missing"); }} />
          </a>
        : <a key={f.id} href={`/api/attachments/${f.id}`} className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border bg-muted px-2 py-1 text-xs text-foreground no-underline" title={`${f.name} · ${kb(f.size)}`}>
            <FileText /><span className="truncate">{f.name}</span><span className="text-muted-foreground">{kb(f.size)}</span>
          </a>)}
    </div>
  );
}
