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
  FIELD_INFO, KIND_INFO, KIND_ORDER, sameRules, withRuleValue,
  type AttachmentRules, type RuleField, type RuleKind, type RulesPayload,
} from "../lib/attachmentRules.ts";

export function AttachmentsPage() {
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [rules, setRules] = useState<AttachmentRules | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    get<RulesPayload>("/api/attachment-rules")
      .then((p) => { setPayload(p); setRules(p.rules); })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (!payload || !rules) {
    return (
      <Page title="Attachment handling">
        {error ? <p className="text-sm text-destructive">{error}</p> : <Skeleton className="h-40 w-full" />}
      </Page>
    );
  }

  const save = async () => {
    setError("");
    try {
      const answer = await put<RulesPayload>("/api/attachment-rules", { rules });
      setPayload(answer);
      setRules(answer.rules);
      setSaved("Saved");
      setTimeout(() => setSaved(""), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setNumber = (kind: RuleKind, field: RuleField, text: string) => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return;
    setRules(withRuleValue(rules, kind, field, n));
  };

  return (
    <Page
      title="Attachment handling"
      actions={<><span className="text-xs text-muted-foreground">{saved}</span><Button onClick={save} disabled={sameRules(rules, payload.rules)}>Save</Button></>}
    >
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-sm text-muted-foreground">
        Limits for attached files, per file type. They apply to files you attach after saving; files already attached keep their copy. Smaller limits cost fewer tokens.
      </p>

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
                <div className="grid gap-4 sm:grid-cols-2">
                  {payload.fields[kind].map((field) => (
                    <Field key={field} label={FIELD_INFO[field].label} hint={FIELD_INFO[field].hint}>
                      <Input
                        type="number"
                        min={payload.ranges[field].min}
                        max={payload.ranges[field].max}
                        step={1}
                        disabled={!rule.enabled}
                        value={rule[field] ?? ""}
                        onChange={(e) => setNumber(kind, field, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              )}
              <div>
                <Button variant="outline" size="sm" onClick={() => setRules({ ...rules, [kind]: payload.defaults[kind] })}>Reset</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </Page>
  );
}
