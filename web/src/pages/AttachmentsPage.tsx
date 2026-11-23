import { useEffect, useState } from "react";
import { get, put } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { Page } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FIELD_INFO, KIND_INFO, KIND_ORDER, kindSame, withKindFrom, withRuleValue,
  type AttachmentRules, type RuleField, type RuleKind, type RulesPayload,
} from "../lib/attachmentRules.ts";

export function AttachmentsPage() {
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [rules, setRules] = useState<AttachmentRules | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKind, setSavedKind] = useState<RuleKind | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    get<RulesPayload>("/api/attachment-rules")
      .then((p) => { setPayload(p); setRules(p.rules); })
      .catch((e) => setError((e as Error).message));
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
      </div>
    </Page>
  );
}
