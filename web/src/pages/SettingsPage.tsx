import { useEffect, useState } from "react";
import { get, post, put, del } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { Page, Section } from "../components/page.tsx";
import { OFFICE_STYLES } from "../office/palette.ts";
import { FEATURE_LABELS } from "../office/layout.ts";
import { LOGO_COLORS, LOGO_GLYPHS, LOGO_SHAPES, shrinkImage } from "../office/logo.ts";
import { LogoMark } from "../office/LogoMark.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Choice } from "../components/inputs.tsx";

export function SettingsPage({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState("");
  const [user, setUser] = useState({ username: "", password: "" });
  const [pw, setPw] = useState({ current: "", password: "" });
  const [msg, setMsg] = useState("");
  const [cache, setCache] = useState<{ folder: string; files: number; bytes: number } | null>(null);
  const loadCache = () => get<{ folder: string; files: number; bytes: number }>("/api/attachments-cache").then(setCache);
  useEffect(() => { loadCache(); }, []);
  const clearCache = async () => {
    if (!confirm(`Delete ${cache?.files} cached file(s)? Chats keep their text; their images show as removed.`)) return;
    await del("/api/attachments-cache");
    loadCache();
  };
  const size = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

  useEffect(() => { get("/api/settings").then(setS); }, []);
  if (!s) return <Page title="Settings"><Skeleton className="h-40 w-full" /></Page>;
  const set = (k: string, v: string) => setS({ ...s, [k]: v });
  const save = async () => { setS(await put("/api/settings", s)); setSaved("Saved"); onChanged(); setTimeout(() => setSaved(""), 2000); };
  const act = async (fn: () => Promise<unknown>, ok: string) => { setMsg(""); try { await fn(); setMsg(ok); } catch (e) { setMsg((e as Error).message); } };

  return (
    <Page title="Settings" actions={<><span className="text-xs text-muted-foreground">{saved}</span><Button onClick={save}>Save</Button></>}>
      <Section title="Office">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" hint="Shown on the office wall and in the sidebar."><Input autoComplete="off" value={s.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
              <Field label="Office style">
                <Choice value={s.office_style} onValueChange={(v) => set("office_style", v)} options={Object.entries(OFFICE_STYLES).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Field>
            </div>
            <div className="flex gap-1.5">
              {(() => { const o = OFFICE_STYLES[s.office_style] ?? OFFICE_STYLES.nordic; return [o.wall, o.floorA, o.desk, o.sofa, o.rug, o.sign].map((c, i) => <span key={i} className="h-4 w-7 rounded-sm" style={{ background: c }} />); })()}
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Office features">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {FEATURE_LABELS.map((f) => (
                <label key={f.key} className="flex items-start gap-2 text-sm" title={f.hint}>
                  <Checkbox className="mt-0.5" checked={s[`office_${f.key}`] !== "false"} onCheckedChange={(v) => set(`office_${f.key}`, v === true ? "true" : "false")} />
                  <span><b>{f.label}</b><span className="block text-xs text-muted-foreground">{f.hint}</span></span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Idle agents walk to whatever is switched on: they play the arcade, try the slot machine, get coffee or sit on the sofa. Team rooms use the teams from the Teams page.</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Company logo">
        <Card>
          <CardContent>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="grid size-32 shrink-0 place-items-center rounded-xl border bg-background"><LogoMark settings={s} size={96} /></div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Shape">
                    <Choice value={s.logo_shape} onValueChange={(v) => set("logo_shape", v)} options={LOGO_SHAPES.map((o) => ({ value: o.key, label: o.label }))} />
                  </Field>
                  <Field label="Symbol">
                    <Choice value={s.logo_glyph} onValueChange={(v) => set("logo_glyph", v)} options={LOGO_GLYPHS.map((o) => ({ value: o.key, label: o.label }))} />
                  </Field>
                </div>
                <Field label="Colour" hint="Auto follows the office style.">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button type="button" size="sm" variant={s.logo_color === "auto" ? "default" : "outline"} onClick={() => set("logo_color", "auto")}>Auto</Button>
                    {LOGO_COLORS.map((c) => (
                      <button key={c} type="button" title={c} aria-label={c} onClick={() => set("logo_color", c)}
                        className="size-6 rounded-full" style={{ background: c, boxShadow: s.logo_color === c ? "0 0 0 2px var(--foreground)" : "0 0 0 2px transparent" }} />
                    ))}
                  </div>
                </Field>
                <Field label="Or use your own image" hint="PNG, JPG or SVG. It replaces the generated mark (shrunk to 256 px and stored in your local settings).">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="file" aria-label="Upload a logo image" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { set("logo_image", await shrinkImage(f)); } catch (err) { setMsg((err as Error).message); }
                      e.target.value = "";
                    }} />
                    {s.logo_image && <Button type="button" variant="outline" size="sm" onClick={() => set("logo_image", "")}>Remove image</Button>}
                  </div>
                </Field>
              </div>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Work">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Who plans, builds and reviews is set per team on the <a href="#/teams">Teams</a> page; each project picks its team.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tasks running at the same time" hint="Each developer works on one task at a time."><Input type="number" min={1} max={8} value={s.max_parallel} onChange={(e) => set("max_parallel", e.target.value)} /></Field>
              <Field label="Fix rounds after a failed check or review" hint="Then the task waits for you."><Input type="number" min={0} max={5} value={s.max_review_rounds} onChange={(e) => set("max_review_rounds", e.target.value)} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={s.auto_run_plans === "true"} onCheckedChange={(v) => set("auto_run_plans", String(v === true))} /> Run plans right away (otherwise you press "Run plan")</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={s.push_and_pr === "true"} onCheckedChange={(v) => set("push_and_pr", String(v === true))} /> Push approved branches and open a pull request (projects with a remote)</label>
          </CardContent>
        </Card>
      </Section>

      <Section title="Spending limits">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Per day (USD, 0 = no limit)" hint="All agent calls since midnight. Queued tasks wait; a call that would start is refused.">
                <Input type="number" min={0} step={1} value={s.budget_day_usd ?? "0"} onChange={(e) => set("budget_day_usd", e.target.value)} />
              </Field>
              <Field label="Per sprint (USD, 0 = no limit)" hint="One sprint including refinement of its items. Applies to Scrum projects.">
                <Input type="number" min={0} step={1} value={s.budget_sprint_usd ?? "0"} onChange={(e) => set("budget_sprint_usd", e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Only finished calls are counted, so a running call can go a little over. Local models and models with no price in <a href="#/usage">Usage</a> count as $0. A warning shows from 80%.</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Attachment cache">
        <Card>
          <CardContent>
            {cache ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs break-all">{cache.folder}</div>
                  <div className="text-xs text-muted-foreground">{cache.files} file{cache.files === 1 ? "" : "s"} · {size(cache.bytes)} · screenshots and files pasted into chats</div>
                </div>
                <Button variant="destructive" disabled={!cache.files} onClick={clearCache}>Clear cache</Button>
              </div>
            ) : <Skeleton className="h-10 w-full" />}
          </CardContent>
        </Card>
      </Section>

      <Section title="Accounts on this machine">
        <Card>
          <CardContent>
            <FieldGroup className="grid gap-4 sm:grid-cols-3">
              <Field label="New user"><Input autoComplete="off" value={user.username} onChange={(e) => setUser({ ...user, username: e.target.value })} /></Field>
              <Field label="Password"><Input type="password" autoComplete="new-password" value={user.password} onChange={(e) => setUser({ ...user, password: e.target.value })} /></Field>
              <Field label=" "><Button variant="outline" onClick={() => act(() => post("/api/users", user), "User added")}>Add user</Button></Field>
              <Field label="Your current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
              <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
              <Field label=" "><Button variant="outline" onClick={() => act(() => post("/api/users/me/password", pw), "Password changed")}>Change password</Button></Field>
            </FieldGroup>
            {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
          </CardContent>
        </Card>
      </Section>
    </Page>
  );
}
