import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Choice } from "../../components/inputs.tsx";
import { decodeText, type TextEncodingName } from "../../lib/decodeText.ts";
import { nextName } from "./datasetName.ts";

const ENCODING_LABELS: Record<TextEncodingName, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 with BOM",
  "utf-16le": "UTF-16",
  "utf-16be": "UTF-16",
  "windows-1252": "Windows-1252 (ANSI)",
};

type Problem = { line: number; message: string };

/** What the Datasets tab shows after an import. */
export type ImportStatus = { message: string; warnings: string[]; needsApproval?: boolean };

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

/** The import form. A failed import stays here with its problems; a good one is handed to `onImported`. */
export function ImportPanel({ projectId, onImported }: {
  projectId: number;
  onImported: (datasetId: number, versionId: number, status: ImportStatus) => void;
}) {
  const [name, setName] = useState("");
  const [format, setFormat] = useState("jsonl");
  const [note, setNote] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [nameTyped, setNameTyped] = useState(false);
  const [formatGuessed, setFormatGuessed] = useState(false);
  const [encoding, setEncoding] = useState<TextEncodingName>("utf-8");
  const fileInput = useRef<HTMLInputElement>(null);

  const clearMessages = () => { setError(""); setProblems([]); setWarnings([]); };

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
    setName(nextName(nameTyped, name, file.name));
    // A pick counts as the name now: the next file renames the dataset again unless the user types.
    setNameTyped(false);
  };

  const doImport = async () => {
    if (text === null) return;
    setBusy(true); clearMessages();
    try {
      // Plain fetch: a 400 carries the problem list, which the shared helper would drop.
      const res = await fetch(`/api/projects/${projectId}/datasets`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ name: name.trim(), format, text, note, source_name: fileName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? res.statusText);
        setProblems(body.problems ?? []);
        setWarnings(body.warnings ?? []);
        return;
      }
      const message = body.unchanged ? `Nothing new: this file is the same as version ${body.version.version}.` : `Saved as version ${body.version.version}.`;
      onImported(body.dataset_id, body.version.id, { message, warnings: body.warnings ?? [], needsApproval: !body.unchanged || !body.version.approved_at });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
      <Card>
        <CardHeader><CardTitle>Import a dataset</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            One case per line (JSON Lines), a JSON array, or a CSV with a header. Each case needs an <code>input</code>; <code>id</code>, <code>expected</code> and <code>tags</code> are optional.
            Importing a name that exists adds a new version; old versions never change.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
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
              <Label htmlFor="ds-file" className="break-all">File{fileName ? `: ${fileName}` : ""}</Label>
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
    </div>
  );
}
