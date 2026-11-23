import { useEffect, useState } from "react";
import { get, put, type Agent } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { Page } from "../components/page.tsx";
import { Choice } from "../components/inputs.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FIELD_INFO, KIND_INFO, KIND_ORDER, kindSame, withKindFrom, withRuleValue,
  type AttachmentRules, type RuleField, type RuleKind, type RulesPayload,
} from "../lib/attachmentRules.ts";

type ScanSettings = { agent: string; pages: string };

export function AttachmentsPage() {
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [rules, setRules] = useState<AttachmentRules | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKind, setSavedKind] = useState<RuleKind | "">("");
  const [error, setError] = useState("");
  // The scan-reader card: what is on screen (draft) and what the server last stored (saved).
  const [scan, setScan] = useState<ScanSettings | null>(null);
  const [scanSaved, setScanSaved] = useState<ScanSettings | null>(null);
  const [scanNote, setScanNote] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    get<RulesPayload>("/api/attachment-rules")
      .then((p) => { setPayload(p); setRules(p.rules); })
      .catch((e) => setError((e as Error).message));
    get<Record<string, string>>("/api/settings")
      .then((s) => {
        const saved = { agent: s.scan_reader_agent_id ?? "", pages: s.scan_reader_max_pages ?? "10" };
        setScan(saved);
        setScanSaved(saved);
      })
      .catch((e) => setError((e as Error).message));
    get<Agent[]>("/api/agents").then(setAgents).catch((e) => setError((e as Error).message));
  }, []);

  if (!payload || !rules) {
    return (
      <Page title="Attachment handling" width="wide">
        {error ?<p className="text-sm text-destructive">{error}</p> : <Skeleton className="h-40 w-full" />}
      </Page>
    );
  }

  // Saves one box. The other boxes keep their unsaved edits in the page state.
  const save = async (kind: RuleKind) => {
    setError("");
    try {
      const answer = await put<RulesPayload>("/api/attachment-rules", { rules: withKindFrom(payload.rules, kind, rules) });
      setPayload(answer);
      setRules((current) => (current ? withKindFrom(current, kind, answer.rules) : current));
      setSavedKind(kind);
      setTimeout(() => setSavedKind(""), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Saves the scan-reader choice. The server clamps the page count, so the stored value comes back in the answer.
  const saveScan = async () => {
    if (!scan) return;
    setError("");
    try {
      const s = await put<Record<string, string>>("/api/settings", { scan_reader_agent_id: scan.agent, scan_reader_max_pages: scan.pages });
      const next = { agent: s.scan_reader_agent_id ?? "", pages: s.scan_reader_max_pages ?? "10" };
      setScan(next);
      setScanSaved(next);
      setScanNote(true);
      setTimeout(() => setScanNote(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The text is kept as typed, so an empty field can be retyped; the rule changes only for a finite number.
  const setNumber = (kind: RuleKind, field: RuleField, text: string) => {
    const key = `${kind}.${field}`;
    setDrafts({ ...drafts, [key]: text });
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) setRules(withRuleValue(rules, kind, field, n));
  };

  const clearDraft = (kind: RuleKind, field: RuleField) => {
    const key = `${kind}.${field}`;
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return (
    <Page title="Attachment handling" width="wide">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-sm text-muted-foreground">
        Limits for attached files, per file type. They apply to files you attach after saving; files already attached keep their copy. Smaller limits cost fewer tokens.
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-2">
      {KIND_ORDER.map((kind) => {
        const rule = rules[kind];
        return (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>{KIND_INFO[kind].label}</CardTitle>
              <CardDescription>{KIND_INFO[kind].files}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={rule.enabled} onCheckedChange={(v) => setRules(withRuleValue(rules, kind, "enabled", v === true))} />
                {KIND_INFO[kind].enabledLabel}
              </label>
              {payload.fields[kind].length > 0 && (
                <div className="grid gap-4">
                  {payload.fields[kind].map((field) => {
                    const key = `${kind}.${field}`;
                    return (
                      <Field key={field} label={FIELD_INFO[field].label} hint={FIELD_INFO[field].hint}>
                        <Input
                          type="number"
                          min={payload.ranges[field].min}
                          max={payload.ranges[field].max}
                          step={1}
                          disabled={!rule.enabled}
                          value={drafts[key] ?? String(rule[field] ?? "")}
                          onChange={(e) => setNumber(kind, field, e.target.value)}
                          onBlur={() => clearDraft(kind, field)}
                        />
                      </Field>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => save(kind)} disabled={kindSame(rules, payload.rules, kind)}>Save</Button>
                <Button variant="outline" size="sm" onClick={() => setRules({ ...rules, [kind]: payload.defaults[kind] })}>Reset</Button>
                {savedKind === kind && <span className="text-xs text-muted-foreground">Saved</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardHeader>
          <CardTitle>Reading scans</CardTitle>
          <CardDescription>Scanned PDFs and photos of documents have no text to copy. Choose the agent whose model should read them (a model that sees images, or an OCR server added as an OpenAI-compatible provider). Reading scans is not switched on yet: this only stores the choice.</CardDescription>
        </CardHeader>
        {scan && (
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4">
              <Field label="Agent that reads scans">
                <Choice
                  label="Agent that reads scans"
                  value={scan.agent}
                  onValueChange={(v) => setScan({ ...scan, agent: v })}
                  options={[
                    { value: "", label: "None" },
                    ...agents.filter((a) => a.enabled !== 0 || String(a.id) === scan.agent).map((a) => ({ value: String(a.id), label: `${a.name} (${a.role === "worker" ? "developer" : a.role === "reviewer" ? "reviewer" : "planner"})` })),
                  ]}
                />
              </Field>
              <Field label="Max pages per file" hint="1–50. Used once scan reading is switched on.">
                <Input type="number" min={1} max={50} step={1} value={scan.pages} onChange={(e) => setScan({ ...scan, pages: e.target.value })} />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveScan} disabled={scanSaved !== null && scanSaved.agent === scan.agent && scanSaved.pages === scan.pages}>Save</Button>
              {scanNote && <span className="text-xs text-muted-foreground">Saved</span>}
            </div>
          </CardContent>
        )}
      </Card>
      </div>
    </Page>
  );
}
