import { useEffect, useRef, useState } from "react";
import { get, post, put } from "../../api.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../../components/ui.tsx";
import { changedFields, countsLine, kindLabel, parseTermLines, requestBody, type Finding, type PreviewCase } from "./pipeline.ts";

type CheckResult = {
  total_cases: number; changed_cases: number; finding_count: number;
  findings: Finding[]; counts: Record<string, number>; preview: PreviewCase[];
};
type ApproveResult = { version: { id: number; version: number }; original_deleted: boolean; kept_reason: string | null };
type Terms = { people: string[]; terms: string[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toggled = (set: ReadonlySet<string>, key: string, on: boolean) => {
  const next = new Set(set);
  if (on) next.delete(key); else next.add(key);
  return next;
};

/** Review of one unapproved dataset version: what the check found, before and after, own terms, and approval. */
export function SensitiveReview({ projectId, versionId, versionNumber, onBack, onApproved }: {
  projectId: number;
  versionId: number;
  versionNumber: number;
  onBack: () => void;
  onApproved: (newVersionId: number, notice: string) => void;
}) {
  const [offKeys, setOffKeys] = useState<ReadonlySet<string>>(new Set());
  const [offKinds, setOffKinds] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<CheckResult | null>(null);
  const [preview, setPreview] = useState<PreviewCase[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState("");
  const [terms, setTerms] = useState("");
  const [again, setAgain] = useState(0);
  const [deleteOriginal, setDeleteOriginal] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [approving, setApproving] = useState(false);
  // Every request takes a number; only the newest one may change the screen.
  const seq = useRef(0);
  const findings = useRef<Finding[]>([]);

  const body = () => requestBody(findings.current, offKeys, offKinds);

  useEffect(() => {
    get<Terms>(`/api/projects/${projectId}/sensitive-terms`)
      .then((t) => { setPeople(t.people.join("\n")); setTerms(t.terms.join("\n")); })
      .catch((e) => setError(message(e)));
  }, [projectId]);

  // A fresh check whenever the choices, the version or the saved terms change.
  useEffect(() => {
    const n = ++seq.current;
    post<CheckResult>(`/api/dataset-versions/${versionId}/check`, requestBody(findings.current, offKeys, offKinds))
      .then((r) => {
        if (n !== seq.current) return;
        findings.current = r.findings;
        setResult(r);
        setPreview(r.preview);
        setError(null);
      })
      .catch((e) => { if (n === seq.current) setError(message(e)); });
  }, [versionId, offKeys, offKinds, again]);

  const showMore = async () => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const r = await post<CheckResult>(`/api/dataset-versions/${versionId}/check`, { ...body(), offset: preview.length });
      if (n !== seq.current) return;
      setPreview((p) => [...p, ...r.preview]);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const saveTerms = async () => {
    setBusy(true);
    try {
      await put(`/api/projects/${projectId}/sensitive-terms`, { people: parseTermLines(people), terms: parseTermLines(terms) });
      setError(null);
      setAgain((x) => x + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    try {
      const r = await post<ApproveResult>(`/api/dataset-versions/${versionId}/approve`, { ...body(), delete_original: deleteOriginal });
      const notice = `Approved as v${r.version.version}.${r.kept_reason ? ` The original v${versionNumber} was kept: ${r.kept_reason}` : ""}`;
      onApproved(r.version.id, notice);
    } catch (e) {
      setError(message(e));
      setApproving(false);
    }
  };

  const kinds = [...new Set((result?.findings ?? []).map((f) => f.kind))];
  const nothingToReplace = !result || result.changed_cases === 0;
  const shownAll = result !== null && preview.length >= result.changed_cases;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div><Button size="sm" variant="outline" onClick={onBack}>Back</Button></div>
      <Card className="min-w-0">
        <CardHeader><CardTitle>Check v{versionNumber} for sensitive data</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {!result && !error && <p role="status" className="text-muted-foreground">Checking…</p>}
          {result && (
            <div role="status" className="flex flex-col gap-1">
              {result.finding_count === 0 ? (
                <p>No sensitive data found in {result.total_cases} cases.</p>
              ) : (
                <>
                  <p>
                    Found {result.finding_count} {result.finding_count === 1 ? "value" : "values"}.
                    {" "}{result.changed_cases} of {result.total_cases} cases change.
                  </p>
                  <p className="text-muted-foreground">To be replaced: {countsLine(result.counts) || "nothing"}.</p>
                </>
              )}
            </div>
          )}

          {kinds.length > 0 && (
            <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="mb-1 font-medium">Kinds to replace</legend>
              {kinds.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox checked={!offKinds.has(k)} onCheckedChange={(v) => setOffKinds(toggled(offKinds, k, v === true))} />
                  {kindLabel(k)}
                </label>
              ))}
            </fieldset>
          )}

          {result && result.findings.length > 0 && (
            <Table aria-label="Findings">
              <TableHeader>
                <TableRow><TableHead>Replace</TableHead><TableHead>Kind</TableHead><TableHead>Value</TableHead><TableHead>Placeholder</TableHead><TableHead>Count</TableHead><TableHead>Example</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {result.findings.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell>
                      <Checkbox aria-label={`Replace ${f.value}`} disabled={offKinds.has(f.kind)} checked={!offKinds.has(f.kind) && !offKeys.has(f.key)}
                        onCheckedChange={(v) => setOffKeys(toggled(offKeys, f.key, v === true))} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{kindLabel(f.kind, 1)}</TableCell>
                    <TableCell className="break-all">{f.value}</TableCell>
                    <TableCell className="whitespace-nowrap">{f.placeholder}</TableCell>
                    <TableCell>{f.count}</TableCell>
                    <TableCell className="whitespace-pre-wrap break-words">{f.examples[0] ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader><CardTitle>Your names and terms</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Names of people (one per line)"><Textarea rows={4} value={people} onChange={(e) => setPeople(e.target.value)} /></Field>
            <Field label="Other terms (one per line)"><Textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">End an entry with * to include word endings, for example Matt*.</p>
          <p className="text-xs text-muted-foreground">Saved for this project on this computer.</p>
          <div><Button variant="outline" disabled={busy} onClick={() => void saveTerms()}>Save and check again</Button></div>
        </CardContent>
      </Card>

      {result && result.changed_cases > 0 && (
        <Card className="min-w-0">
          <CardHeader><CardTitle>Before and after</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul aria-label="Changed cases" className="flex flex-col gap-3">
              {preview.map((c) => (
                <li key={c.case_key} className="flex flex-col gap-1 rounded-md border p-3">
                  <span className="font-medium">{c.case_key}</span>
                  {changedFields(c).map((f) => (
                    <div key={f.field} className="grid gap-1 md:grid-cols-2">
                      <div><span className="text-xs text-muted-foreground">Before, {f.field}</span><p className="whitespace-pre-wrap break-words">{f.before}</p></div>
                      <div><span className="text-xs text-muted-foreground">After, {f.field}</span><p className="whitespace-pre-wrap break-words">{f.after}</p></div>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Showing {preview.length} of {result.changed_cases} changed cases.</p>
            {!shownAll && <div><Button variant="outline" disabled={busy} onClick={() => void showMore()}>Show more</Button></div>}
          </CardContent>
        </Card>
      )}

      <Card className="min-w-0">
        <CardHeader><CardTitle>Approve</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Automatic detection is not perfect. Names and details in free text are only found when you list them above, and rare combinations of facts are not detected.
            Read the preview before approving.
          </p>
          <label className="flex items-center gap-2">
            <Checkbox checked={deleteOriginal} onCheckedChange={(v) => setDeleteOriginal(v === true)} />
            Delete the original after approval
          </label>
          <div>
            <Button disabled={!result || approving} onClick={() => { if (deleteOriginal && !nothingToReplace) setConfirm(true); else void approve(); }}>Approve</Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve and delete the original?</AlertDialogTitle>
            <AlertDialogDescription>The original v{versionNumber} is permanently deleted. Only the cleaned version stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirm(false); void approve(); }}>Approve and delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
