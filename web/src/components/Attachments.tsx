import { FileText, Loader2, X } from "lucide-react";
import type { AttachmentInfo } from "../api.ts";

export type Pending = { key: string; name: string; mime: string; size: number; preview?: string; id?: number; error?: string };

const kb = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Files waiting in the composer: thumbnails for images, a chip for other files. */
export function PendingFiles({ files, onRemove }: { files: Pending[]; onRemove: (key: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="att-row">
      {files.map((f) => (
        <div key={f.key} className={`att ${f.error ? "att-error" : ""}`} title={f.error ?? `${f.name} · ${kb(f.size)}`}>
          {f.preview ? <img src={f.preview} alt={f.name} /> : <FileText size={18} />}
          <span className="att-name">{f.error ?? f.name}</span>
          {!f.id && !f.error && <Loader2 size={13} className="spin" />}
          <button type="button" className="att-x" onClick={() => onRemove(f.key)} aria-label={`Remove ${f.name}`}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

/** Files on a sent message. Images open full size in a new tab. */
export function MessageFiles({ files }: { files: AttachmentInfo[] }) {
  if (!files.length) return null;
  return (
    <div className="att-row sent">
      {files.map((f) => f.mime.startsWith("image/")
        ? <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" className="att-img" title={f.name}>
            <img src={`/api/attachments/${f.id}`} alt={f.name} onError={(e) => { (e.currentTarget.parentElement as HTMLElement).classList.add("att-missing"); }} />
          </a>
        : <a key={f.id} href={`/api/attachments/${f.id}`} className="att" title={`${f.name} · ${kb(f.size)}`}>
            <FileText size={16} /><span className="att-name">{f.name}</span><span className="hint">{kb(f.size)}</span>
          </a>)}
    </div>
  );
}
