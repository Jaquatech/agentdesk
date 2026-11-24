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

/** What the conversion status means, shown under the message. The name stays on the line so two files are not mixed up. */
export function attachmentStatusText(file: { name: string; status?: string }): string {
  const status = file.status;
  if (!status) return "";
  if (status === "converted") return `${file.name}: Converted to Markdown`;
  if (status === "truncated") return `${file.name}: Converted to Markdown, cut short`;
  if (status === "needs_ocr") return `${file.name}: No text layer. Choose an agent under Attachment handling > Reading scans to read it.`;
  if (status.startsWith("failed:")) return `${file.name}: Not converted: ${status.slice("failed:".length).trim()}`;
  return `${file.name}: ${status}`;
}

/** Files on a sent message. Images open full size in a new tab. A file the model did not receive shows its note underneath. */
export function MessageFiles({ files }: { files: AttachmentInfo[] }) {
  if (!files.length) return null;
  const lines = files.flatMap((f) => [attachmentStatusText(f), f.note ?? "", f.image_note ? `${f.name}: ${f.image_note}` : ""]
    .filter(Boolean).map((text) => ({ id: f.id, text })));
  return (
    <div className="flex flex-col items-end gap-1 pt-1.5">
      <div className="flex flex-wrap items-start justify-end gap-2">
        {files.map((f) => f.mime.startsWith("image/")
          ? <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-muted no-underline" title={f.name}>
              <img src={`/api/attachments/${f.id}`} alt={f.name} className="block max-h-50 max-w-70 object-contain" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).classList.add("att-missing"); }} />
            </a>
          : <a key={f.id} href={`/api/attachments/${f.id}`} className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border bg-muted px-2 py-1 text-xs text-foreground no-underline" title={`${f.name} · ${kb(f.size)}`}>
              <FileText /><span className="truncate">{f.name}</span><span className="text-muted-foreground">{kb(f.size)}</span>
            </a>)}
      </div>
      {lines.map((line, i) => <p key={`${line.id}-${i}`} className="max-w-sm text-right text-xs text-muted-foreground">{line.text}</p>)}
    </div>
  );
}
