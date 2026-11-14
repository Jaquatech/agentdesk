import { useEffect, useState } from "react";
import { KeyRound, Plus, PlugZap } from "lucide-react";
import { get, post, put, del, type Provider, type ProviderKind, type Secret } from "../api.ts";
import { Field, FooterGap, Modal, ago } from "../components/ui.tsx";
import { Choice, ModelPicker, NoFillInput, SecretInput } from "../components/inputs.tsx";
import { Page, Section } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const KINDS: Record<ProviderKind, { label: string; note: string; needsKey: boolean; model: string }> = {
  anthropic: { label: "Anthropic API", note: "Claude models through the Messages API.", needsKey: true, model: "claude-sonnet-5-5" },
  openai: { label: "OpenAI-compatible", note: "OpenAI, Azure OpenAI (v1), vLLM, LM Studio, llama.cpp server, OpenLLM.", needsKey: false, model: "gpt-5" },
  ollama: { label: "Ollama (local or cloud)", note: "Local Ollama needs no key. For Ollama Cloud set Base URL https://ollama.com and add your API key (ollama.com/settings/keys).", needsKey: false, model: "qwen3:8b" },
  "claude-cli": { label: "Claude Code CLI", note: "Runs `claude -p` in the worktree (needs Claude Code installed). Key optional: without it your Claude Code sign-in is used.", needsKey: false, model: "sonnet" },
};

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [editing, setEditing] = useState<Partial<Provider> | null>(null);
  const [secretEdit, setSecretEdit] = useState<Partial<Secret> | null>(null);
  const [tests, setTests] = useState<Record<number, { ok: boolean; message: string } | "…">>({});

  const load = () => {
    get<{ providers: Provider[]; defaults: Record<string, string> }>("/api/providers").then((d) => { setProviders(d.providers); setDefaults(d.defaults); });
    get<Secret[]>("/api/secrets").then(setSecrets);
  };
  useEffect(load, []);

  const test = async (p: Provider) => {
    setTests((t) => ({ ...t, [p.id]: "…" }));
    const r = await post<{ ok: boolean; message: string }>(`/api/providers/${p.id}/test`);
    setTests((t) => ({ ...t, [p.id]: r }));
  };

  return (
    <Page title="Providers & keys">
      <p className="text-sm text-muted-foreground">
        Only this local server talks to model APIs. Keys are encrypted on this machine with a key file kept outside the database,
        and are never sent back to the browser.
      </p>
      <Section title="Providers" action={<Button variant="outline" onClick={() => setEditing({ kind: "anthropic", name: "", base_url: "", default_model: KINDS.anthropic.model, price_in: 0, price_out: 0 })}><Plus data-icon="inline-start" /> New provider</Button>}>
        <Card className="gap-0 py-0">
          {providers.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No providers yet.</div>}
          {providers.map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <PlugZap className="text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <b>{p.name}</b> <Badge variant="secondary">{KINDS[p.kind].label}</Badge>
                  <div className="truncate font-mono text-xs text-muted-foreground">{p.base_url || defaults[p.kind] || "local program"} · {p.default_model || "no default model"}{p.secret_name ? ` · key: ${p.secret_name}` : ""}</div>
                  {t && t !== "…" && <div className={t.ok ? "text-xs text-success" : "text-xs text-destructive"}>{t.message}</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => test(p)} disabled={t === "…"}>{t === "…" ? "Testing…" : "Test"}</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
              </div>
            );
          })}
        </Card>
      </Section>

      <Section title="Secrets" action={<Button variant="outline" onClick={() => setSecretEdit({ name: "" })}><Plus data-icon="inline-start" /> New secret</Button>}>
        <Card className="gap-0 py-0">
          {secrets.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No secrets yet.</div>}
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <KeyRound className="text-muted-foreground" />
              <b>{s.name}</b>
              <span className="font-mono text-xs text-muted-foreground">{s.hint}</span>
              <span className="ml-auto text-xs text-muted-foreground">updated {ago(s.updated_at)}</span>
              <Button size="sm" variant="outline" onClick={() => setSecretEdit(s)}>Replace</Button>
            </div>
          ))}
        </Card>
      </Section>
      {editing && <ProviderForm p={editing} secrets={secrets} defaults={defaults} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {secretEdit && <SecretForm s={secretEdit} onClose={() => setSecretEdit(null)} onSaved={() => { setSecretEdit(null); load(); }} />}
    </Page>
  );
}

function ProviderForm({ p, secrets, defaults, onClose, onSaved }: {
  p: Partial<Provider>; secrets: Secret[]; defaults: Record<string, string>; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({ ...p });
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<{ ok: boolean; message: string } | "…" | null>(p.id ? "…" : null);
  const [models, setModels] = useState<string[]>([]);
  const kind = (f.kind ?? "anthropic") as ProviderKind;
  const set = (k: keyof Provider, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const testNow = async () => {
    try {
      const r = await post<{ ok: boolean; message: string; models?: string[] }>("/api/providers/test-config", { ...f, kind, key: newKey });
      setTest(r);
      if (r.models?.length) {
        setModels(r.models);
        if (!f.default_model) set("default_model", r.models.find((m) => m.includes("sonnet")) ?? r.models[0]);
      }
    } catch (e) { setTest({ ok: false, message: (e as Error).message }); }
  };
  const runTest = () => { setTest("…"); testNow(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- tests a saved provider once, when the form opens
  useEffect(() => { if (p.id) testNow(); }, []);

  const save = async () => {
    setError("");
    try {
      let secret_id = f.secret_id ?? null;
      if (newKey.trim()) {
        const r = await post<{ id: number }>("/api/secrets", { name: `${f.name || kind} key`, value: newKey });
        secret_id = r.id;
      }
      const body = { ...f, kind, secret_id };
      if (p.id) await put(`/api/providers/${p.id}`, body); else await post("/api/providers", body);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`Delete provider ${p.name}? Agents using it stop working until you pick another.`)) return;
    await del(`/api/providers/${p.id}`);
    onSaved();
  };

  return (
    <Modal title={p.id ? `Edit ${p.name}` : "New provider"} onClose={onClose}
      footer={<>
        {p.id && <Button variant="destructive" onClick={remove}>Delete</Button>}
        <FooterGap />
        <Button variant="outline" onClick={runTest} disabled={test === "…"}><PlugZap data-icon="inline-start" /> {test === "…" ? "Testing…" : "Test connection"}</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </>}>
      <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><NoFillInput value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Anthropic EU" /></Field>
          <Field label="Type">
            <Choice value={kind} onValueChange={(v) => { set("kind", v); set("default_model", KINDS[v as ProviderKind].model); setModels([]); setTest(null); }}
              options={(Object.keys(KINDS) as ProviderKind[]).map((k) => ({ value: k, label: KINDS[k].label }))} />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">{KINDS[kind].note}</p>
        {kind !== "claude-cli" && (
          <Field label="Base URL" hint="Leave empty for the default.">
            <NoFillInput className="font-mono" value={f.base_url ?? ""} onChange={(e) => set("base_url", e.target.value)} placeholder={defaults[kind]} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`API key${KINDS[kind].needsKey ? "" : " (optional)"}`}>
            <Choice value={f.secret_id ? String(f.secret_id) : ""} onValueChange={(v) => set("secret_id", v ? Number(v) : null)}
              options={[{ value: "", label: KINDS[kind].needsKey ? "Choose or paste a new key…" : "None" }, ...secrets.map((s) => ({ value: String(s.id), label: `${s.name} (${s.hint})` }))]} />
          </Field>
          <Field label="…or paste a new key"><SecretInput value={newKey} onChange={setNewKey} placeholder="stored encrypted" /></Field>
        </div>
        <Field label="Default model" hint={!models.length ? "Press Test connection to load the list."
          : f.default_model && !models.includes(f.default_model) ? <span className="text-destructive">"{f.default_model}" is not in this provider's list. Pick one or calls will fail.</span> : undefined}>
          <ModelPicker models={models} value={f.default_model ?? ""} onChange={(v) => set("default_model", v)} />
        </Field>
        {test && test !== "…" && <p className={test.ok ? "text-sm text-success" : "text-sm text-destructive"}>{test.ok ? "✓ " : "✗ "}{test.message}</p>}
        <p className="text-sm text-muted-foreground">Prices are set per model under <a href="#/usage">Usage &amp; billing</a>, so each agent is billed at its own model's rate.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </Modal>
  );
}

function SecretForm({ s, onClose, onSaved }: { s: Partial<Secret>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(s.name ?? "");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    try {
      if (s.id) await put(`/api/secrets/${s.id}`, { name, value }); else await post("/api/secrets", { name, value });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => { if (confirm(`Delete secret ${s.name}?`)) { await del(`/api/secrets/${s.id}`); onSaved(); } };
  return (
    <Modal title={s.id ? `Replace ${s.name}` : "New secret"} onClose={onClose}
      footer={<>{s.id && <Button variant="destructive" onClick={remove}>Delete</Button>}<FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <Field label="Name"><NoFillInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={s.id ? "New value (leave empty to keep the current one)" : "Value"} hint="Encrypted on this machine; never shown again.">
        <SecretInput value={value} onChange={setValue} />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
