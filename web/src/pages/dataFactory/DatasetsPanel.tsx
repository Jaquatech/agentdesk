import { useRef, useState } from "react";
import { del, useLoad } from "../../api.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Choice } from "../../components/inputs.tsx";
import { decodeText, type TextEncodingName } from "../../lib/decodeText.ts";
import { localTime } from "./localTime.ts";

const ENCODING_LABELS: Record<TextEncodingName, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 with BOM",
  "utf-16le": "UTF-16",
  "utf-16be": "UTF-16",
  "windows-1252": "Windows-1252 (ANSI)",
};

type DatasetRow = { id: number; name: string; version: number; version_id: number; format: string; case_count: number; note: string };
type Version = { id: number; version: number; format: string; case_count: number; note: string; created_at: string };
type DatasetDetail = { id: number; name: string; versions: Version[] };
type CaseRow = { position: number; case_key: string; input: string; expected: string | null; tags: string[] };
type Problem = { line: number; message: string };

const FORMATS = [
  { value: "jsonl", label: "JSON Lines (.jsonl)" },
  { value: "json", label: "JSON array (.json)" },
  { value: "csv", label: "CSV (.csv)" },
];

/** The format a file name suggests, or "" when the extension says nothing. */
function guessFormat(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "json") return "json";
  if (ext === "csv") return "csv";
  return "";
}

/** Datasets of one project: import a file, see problems and notes, browse versions and their first cases. */
export function DatasetsPanel({ projectId }: { projectId: number }) {
  const list = useLoad<DatasetRow[]>(`/api/projects/${projectId}/datasets`);
  const [openId, setOpenId] = useState<number | null>(null);
  const [pickedVersion, setVersionId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [format, setFormat] = useState("jsonl");
  const [note, setNote] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DatasetRow | null>(null);
  const [nameTyped, setNameTyped] = useState(false);
  const [formatGuessed, setFormatGuessed] = useState(false);
  const [encoding, setEncoding] = useState<TextEncodingName>("utf-8");
  const fileInput = useRef<HTMLInputElement>(null);

  const detail = useLoad<DatasetDetail>(openId === null ? null : `/api/datasets/${openId}`);
  // The chosen version, or the newest one of the open dataset until the user picks another.
  const shown = detail.data && detail.data.id === openId ? detail.data : null;
  const versionId = shown ? (shown.versions.some((v) => v.id === pickedVersion) ? pickedVersion : (shown.versions[0]?.id ?? null)) : null;
  const cases = useLoad<CaseRow[]>(versionId === null ? null : `/api/dataset-versions/${versionId}/cases?limit=20`);

  const clearMessages = () => { setError(""); setProblems([]); setWarnings([]); setMessage(""); };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    clearMessages();
    const decoded = decodeText(await file.arrayBuffer());
    setText(decoded.text);
    setEncoding(decoded.encoding);
    setFileName(file.name);
    const guessed = guessFormat(file.name);
    if (guessed) setFormat(guessed);
    setFormatGuessed(guessed !== "");
    if (!nameTyped) setName(file.name.replace(/\.[^.]+$/, ""));
  };

  const doImport = async () => {
    if (text === null) return;
    setBusy(true); clearMessages();
    try {
      // Plain fetch: a 400 carries the problem list, which the shared helper would drop.
      const res = await fetch(`/api/projects/${projectId}/datasets`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ name: name.trim(), format, text, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? res.statusText);
        setProblems(body.problems ?? []);
        setWarnings(body.warnings ?? []);
        return;
      }
      setWarnings(body.warnings ?? []);
      setMessage(body.unchanged ? `Nothing new: this file is the same as version ${body.version.version}.` : `Saved as version ${body.version.version}.`);
      setOpenId(body.dataset_id);
      setVersionId(body.version.id);
      setText(null); setFileName(""); setNote(""); setName(""); setNameTyped(false);
      setFormatGuessed(false); setEncoding("utf-8");
      if (fileInput.current) fileInput.current.value = "";
      list.reload();
      detail.reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await del(`/api/datasets/${id}`);
    if (openId === id) { setOpenId(null); setVersionId(null); }
    list.reload();
  };

  const rows = list.data ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4 lg:order-2">
      <Card>
        <CardHeader><CardTitle>Import a dataset</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            One case per line (JSON Lines), a JSON array, or a CSV with a header. Each case needs an <code>input</code>; <code>id</code>, <code>expected</code> and <code>tags</code> are optional.
            Importing a name that exists adds a new version; old versions never change.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-name">Name</Label>
              <Input id="ds-name" value={name} onChange={(e) => { setName(e.target.value); setNameTyped(true); clearMessages(); }} maxLength={120} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-format">Format</Label>
              <Choice id="ds-format" value={format} onValueChange={(v) => { setFormat(v); setFormatGuessed(false); clearMessages(); }} options={FORMATS} />
              {formatGuessed && <p className="text-xs text-muted-foreground">Guessed from the file name. Change it if the import fails.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-file">File{fileName ? `: ${fileName}` : ""}</Label>
              <Input id="ds-file" ref={fileInput} type="file" accept=".jsonl,.ndjson,.json,.csv,text/plain" onChange={(e) => void pickFile(e.target.files?.[0])} />
              {text !== null && encoding !== "utf-8" && <p className="text-xs text-muted-foreground">Read as {ENCODING_LABELS[encoding]}.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-note">Note (optional)</Label>
              <Input id="ds-note" value={note} onChange={(e) => { setNote(e.target.value); clearMessages(); }} maxLength={500} autoComplete="off" />
            </div>
          </div>
          <div>
            <Button onClick={() => void doImport()} disabled={busy || text === null || !name.trim()}>{busy ? "Importing…" : "Import"}</Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
              {problems.length > 0 && (
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {problems.map((p, i) => <li key={i}>Line {p.line}: {p.message}</li>)}
                  </ul>
                  <p className="mt-1">Nothing was stored. Fix the file and import it again.</p>
                </AlertDescription>
              )}
            </Alert>
          )}
          {message && <p role="status" className="text-sm">{message}</p>}
          {warnings.length > 0 && (
            <Alert>
              <AlertTitle>Notes</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Datasets</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {list.error && <p className="text-sm text-destructive">{list.error}</p>}
          {list.data && rows.length === 0 && <p className="text-sm text-muted-foreground">No datasets yet.</p>}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Latest</TableHead><TableHead>Cases</TableHead><TableHead>Format</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>v{d.version}</TableCell>
                    <TableCell>{d.case_count}</TableCell>
                    <TableCell>{d.format}</TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" aria-pressed={openId === d.id} onClick={() => { setOpenId(d.id); setVersionId(null); }}>Versions</Button>
                      <Button size="sm" variant="outline" aria-label={`Delete ${d.name}`} onClick={() => setPendingDelete(d)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </div>

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

      <Card className="lg:order-1">
        <CardHeader><CardTitle>{shown ? `${shown.name}: versions` : "Cases"}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!shown && <p className="text-sm text-muted-foreground">Pick a dataset to see its cases.</p>}
          {shown && (<>
            <div className="flex flex-wrap gap-2">
              {shown.versions.map((v) => (
                <Button key={v.id} size="sm" variant={v.id === versionId ? "default" : "outline"} aria-pressed={v.id === versionId} onClick={() => setVersionId(v.id)}>
                  v{v.version} <Badge variant="secondary">{v.case_count}</Badge>
                </Button>
              ))}
            </div>
            {(() => {
              const v = shown.versions.find((x) => x.id === versionId);
              return v ? <p className="text-sm text-muted-foreground">Imported {localTime(v.created_at)} as {v.format}.{v.note ? ` ${v.note}` : ""}</p> : null;
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
                      <TableCell className="max-w-md whitespace-pre-wrap break-words">{c.input.length > 300 ? `${c.input.slice(0, 300)}…` : c.input}</TableCell>
                      <TableCell className="max-w-xs whitespace-pre-wrap break-words">{c.expected ?? ""}</TableCell>
                      <TableCell>{c.tags.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {cases.data && <p className="text-xs text-muted-foreground">First {cases.data.length} cases.</p>}
          </>)}
        </CardContent>
      </Card>
    </div>
  );
}
