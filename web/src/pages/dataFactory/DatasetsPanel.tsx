import { useState } from "react";
import { Trash2 } from "lucide-react";
import { del, parseJson, useLoad } from "../../api.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { localTime } from "./localTime.ts";
import type { ImportStatus } from "./ImportPanel.tsx";
import { countsLine } from "./pipeline.ts";
import { SensitiveReview } from "./SensitiveReview.tsx";

type DatasetRow = { id: number; name: string; version: number; version_id: number; format: string; case_count: number; note: string; approved_at: string | null };
type Version = {
  id: number; version: number; format: string; case_count: number; note: string; source_name: string; created_at: string;
  approved_at: string | null; cleaned_from: number | null; cleaned_counts: string;
};
type DatasetDetail = { id: number; name: string; versions: Version[] };
type CaseRow = { position: number; case_key: string; input: string; expected: string | null; tags: string[] };

/** The open dataset and version; the page keeps it so it survives a tab switch. */
export type DatasetPick = { datasetId: number | null; versionId: number | null };

/** Datasets of one project: the narrow list, the versions of the open one and its first cases. */
export function DatasetsPanel({ projectId, pick, onPick, status, onStatusDone }: {
  projectId: number;
  pick: DatasetPick;
  onPick: (pick: DatasetPick) => void;
  status: ImportStatus | null;
  onStatusDone: () => void;
}) {
  const list = useLoad<DatasetRow[]>(`/api/projects/${projectId}/datasets`);
  const { datasetId: openId, versionId: pickedVersion } = pick;
  const [pendingDelete, setPendingDelete] = useState<DatasetRow | null>(null);
  const [pendingVersion, setPendingVersion] = useState<Version | null>(null);
  // The version under review, and the sentence after an approval; both end when another dataset or version opens.
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const choose = (next: DatasetPick) => { setReviewing(null); setNotice(null); setActionError(null); onPick(next); };

  // The server lists datasets by name; the newest (highest id) comes first, so the first one opens by itself.
  const rows = [...(list.data ?? [])].sort((a, b) => b.id - a.id);
  // The chosen dataset, or the first one when none is chosen (or the chosen one is gone).
  const current = rows.some((d) => d.id === openId) ? openId : (rows[0]?.id ?? null);
  const detail = useLoad<DatasetDetail>(current === null ? null : `/api/datasets/${current}`);
  // The chosen version, or the newest one of the open dataset until the user picks another.
  const shown = detail.data && detail.data.id === current ? detail.data : null;
  const versionId = shown ? (shown.versions.some((v) => v.id === pickedVersion) ? pickedVersion : (shown.versions[0]?.id ?? null)) : null;
  const cases = useLoad<CaseRow[]>(versionId === null ? null : `/api/dataset-versions/${versionId}/cases?limit=20`);

  const remove = async (id: number) => {
    await del(`/api/datasets/${id}`);
    if (openId === id) onPick({ datasetId: null, versionId: null });
    list.reload();
  };

  const removeVersion = async (v: Version) => {
    setActionError(null);
    try {
      await del(`/api/dataset-versions/${v.id}`);
      onPick({ datasetId: current, versionId: null });
      detail.reload();
      list.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const approved = (newVersionId: number, text: string) => {
    setReviewing(null);
    setNotice(text);
    onPick({ datasetId: current, versionId: newVersionId });
    detail.reload();
    list.reload();
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
      {rows.length > 0 && (
        <nav aria-label="Datasets" className="max-h-60 min-h-0 overflow-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
          <ul className="flex flex-col">
            {rows.map((d) => (
              <li key={d.id} className={cn("flex items-center gap-2 border-b pr-2 hover:bg-accent/50", current === d.id && "bg-accent")} aria-current={current === d.id ? "true" : undefined}>
                <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset" onClick={() => { onStatusDone(); choose({ datasetId: d.id, versionId: null }); }}>
                  <span className="truncate text-sm font-medium" title={d.name}>{d.name}</span>
                  <span className="text-xs text-muted-foreground">v{d.version} · {d.case_count} cases{d.approved_at ? "" : " · Not approved"}</span>
                </button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => setPendingDelete(d)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className={cn("flex min-h-0 min-w-0 flex-col gap-4 overflow-auto p-6", rows.length === 0 && "lg:col-span-2")}>
      {list.error && <p className="text-sm text-destructive">{list.error}</p>}
      {rows.length === 0 && list.data && (
        <p className="text-sm text-muted-foreground">No datasets yet. <a className="underline" href={`#/data-factory/${projectId}?tab=import`}>Import one</a>.</p>
      )}
      {status && (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm">{status.message}{status.needsApproval ? " Check and approve it before running." : ""}</p>
          {status.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">{status.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
        </div>
      )}

      {notice && <p role="status" className="text-sm">{notice}</p>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {shown && versionId !== null && reviewing === versionId && (
        <SensitiveReview key={versionId} projectId={projectId} versionId={versionId} versionNumber={shown.versions.find((x) => x.id === versionId)?.version ?? 0}
          onBack={() => setReviewing(null)} onApproved={approved} />
      )}

      {shown && reviewing !== versionId && (
      <Card className="min-w-0">
        <CardHeader><CardTitle>{shown.name}: versions</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {shown.versions.map((v) => (
              <Button key={v.id} size="sm" variant={v.id === versionId ? "default" : "outline"} aria-pressed={v.id === versionId} onClick={() => choose({ datasetId: current, versionId: v.id })}>
                v{v.version} <Badge variant="secondary">{v.case_count}</Badge>{!v.approved_at && <Badge variant="outline">Not approved</Badge>}
              </Button>
            ))}
          </div>
          {(() => {
            const v = shown.versions.find((x) => x.id === versionId);
            if (!v) return null;
            const origin = v.source_name ? `from ${v.source_name} (${v.format})` : `as ${v.format}`;
            const replaced = v.cleaned_from !== null ? countsLine(parseJson<Record<string, number>>(v.cleaned_counts, {})) : "";
            return (
              <>
                {v.cleaned_from === null && (
                  <p className="text-sm text-muted-foreground">Imported {localTime(v.created_at)} {origin}.{v.note ? ` ${v.note}` : ""}</p>
                )}
                {v.approved_at ? (
                  <p className="text-sm">
                    Approved {localTime(v.approved_at)}
                    {v.cleaned_from !== null && <>. Anonymized from v{v.cleaned_from}{replaced ? `: ${replaced} replaced` : ""}</>}.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Not approved</span>
                    <Button size="sm" onClick={() => { setNotice(null); setActionError(null); setReviewing(v.id); }}>Check for sensitive data</Button>
                    {shown.versions.length > 1 && <Button size="sm" variant="outline" onClick={() => setPendingVersion(v)}>Delete this version</Button>}
                  </div>
                )}
              </>
            );
          })()}
          {cases.data && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Id</TableHead><TableHead>Input</TableHead><TableHead>Expected</TableHead><TableHead>Tags</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {cases.data.map((c) => (
                  <TableRow key={`${c.position}`}>
                    <TableCell className="whitespace-nowrap">{c.case_key}</TableCell>
                    <TableCell className="whitespace-pre-wrap break-words">{c.input.length > 300 ? `${c.input.slice(0, 300)}…` : c.input}</TableCell>
                    <TableCell className="whitespace-pre-wrap break-words">{c.expected ?? ""}</TableCell>
                    <TableCell>{c.tags.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {cases.data && <p className="text-xs text-muted-foreground">First {cases.data.length} cases.</p>}
        </CardContent>
      </Card>
      )}
      </div>

      <AlertDialog open={pendingVersion !== null} onOpenChange={(open) => { if (!open) setPendingVersion(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this version?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingVersion ? `Version ${pendingVersion.version} and its cases are permanently deleted.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { const v = pendingVersion; setPendingVersion(null); if (v) void removeVersion(v); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `"${pendingDelete.name}" and all its versions are removed.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { const id = pendingDelete?.id; setPendingDelete(null); if (id !== undefined) void remove(id); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
