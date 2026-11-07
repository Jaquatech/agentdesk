import { useEffect, useState } from "react";
import { KeyRound, Plus, PlugZap } from "lucide-react";
import { get, post, put, del, type Provider, type ProviderKind, type Secret } from "../api.ts";
import { Field, Modal, ago } from "../components/ui.tsx";
import { ModelPicker, NoFillInput, SecretInput } from "../components/inputs.tsx";

const KINDS: Record<ProviderKind, { label: string; note: string; needsKey: boolean; model: string }> = {
  anthropic: { label: "Anthropic API", note: "Claude models through the Messages API.", needsKey: true, model: "claude-sonnet-5-5" },
  openai: { label: "OpenAI-compatible", note: "OpenAI, Azure OpenAI (v1), vLLM, LM Studio, llama.cpp server, OpenLLM.", needsKey: false, model: "gpt-5" },
  ollama: { label: "Ollama (local)", note: "Local models through Ollama's OpenAI-compatible endpoint. No key.", needsKey: false, model: "qwen3:8b" },
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
    <>
      <div className="page-head"><h1>Providers &amp; keys</h1></div>
      <div className="page"><div className="narrow">
        <p className="hint" style={{ marginTop: 0 }}>
          Only this local server talks to model APIs. Keys are encrypted on this machine with a key file kept outside the database,
          and are never sent back to the browser.
        </p>
        <div className="section-title">
          <h2>Providers</h2><span className="spacer" />
          <button className="btn" onClick={() => setEditing({ kind: "anthropic", name: "", base_url: "", default_model: KINDS.anthropic.model, price_in: 0, price_out: 0 })}><Plus size={14} /> New provider</button>
        </div>
        <div className="list">
          {providers.length === 0 && <div className="list-row hint">No providers yet.</div>}
          {providers.map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="list-row">
                <PlugZap size={16} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{p.name}</b> <span className="badge">{KINDS[p.kind].label}</span>
                  <div className="hint mono">{p.base_url || defaults[p.kind] || "local program"} · {p.default_model || "no default model"}{p.secret_name ? ` · key: ${p.secret_name}` : ""}</div>
                  {t && t !== "…" && <div className={t.ok ? "hint" : "error"} style={t.ok ? { color: "var(--good)" } : undefined}>{t.message}</div>}
                </div>
                <button className="btn small" onClick={() => test(p)} disabled={t === "…"}>{t === "…" ? "Testing…" : "Test"}</button>
                <button className="btn small" onClick={() => setEditing(p)}>Edit</button>
              </div>
            );
          })}
        </div>

        <div className="section-title">
          <h2>Secrets</h2><span className="spacer" />
          <button className="btn" onClick={() => setSecretEdit({ name: "" })}><Plus size={14} /> New secret</button>
        </div>
        <div className="list">
          {secrets.length === 0 && <div className="list-row hint">No secrets yet.</div>}
          {secrets.map((s) => (
            <div key={s.id} className="list-row">
              <KeyRound size={15} />
              <b>{s.name}</b>
              <span className="mono hint">{s.hint}</span>
              <span className="spacer" />
              <span className="hint">updated {ago(s.updated_at)}</span>
              <button className="btn small" onClick={() => setSecretEdit(s)}>Replace</button>
            </div>
          ))}
        </div>
      </div></div>
      {editing && <ProviderForm p={editing} secrets={secrets} defaults={defaults} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {secretEdit && <SecretForm s={secretEdit} onClose={() => setSecretEdit(null)} onSaved={() => { setSecretEdit(null); load(); }} />}
    </>
  );
}

function ProviderForm({ p, secrets, defaults, onClose, onSaved }: {
  p: Partial<Provider>; secrets: Secret[]; defaults: Record<string, string>; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({ ...p });
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<{ ok: boolean; message: string } | "…" | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const kind = (f.kind ?? "anthropic") as ProviderKind;
  const set = (k: keyof Provider, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  // Test with what is in the form now (nothing saved yet); a working connection loads the model list.
  const runTest = async () => {
    setTest("…");
    try {
      const r = await post<{ ok: boolean; message: string; models?: string[] }>("/api/providers/test-config", { ...f, kind, key: newKey });
      setTest(r);
      if (r.models?.length) {
        setModels(r.models);
        if (!f.default_model) set("default_model", r.models.find((m) => m.includes("sonnet")) ?? r.models[0]);
      }
    } catch (e) { setTest({ ok: false, message: (e as Error).message }); }
  };
  useEffect(() => { if (p.id) runTest(); }, []);

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
        {p.id && <button className="btn danger" onClick={remove}>Delete</button>}
        <span className="spacer" />
        <button className="btn" onClick={runTest} disabled={test === "…"}><PlugZap size={14} /> {test === "…" ? "Testing…" : "Test connection"}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </>}>
      <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <div className="grid2">
          <Field label="Name"><NoFillInput value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Anthropic EU" /></Field>
          <Field label="Type">
            <select value={kind} onChange={(e) => { set("kind", e.target.value); set("default_model", KINDS[e.target.value as ProviderKind].model); setModels([]); setTest(null); }}>
              {(Object.keys(KINDS) as ProviderKind[]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          </Field>
        </div>
        <p className="hint" style={{ marginTop: -4 }}>{KINDS[kind].note}</p>
        {kind !== "claude-cli" && (
          <Field label="Base URL" hint="Leave empty for the default.">
            <NoFillInput className="mono" value={f.base_url ?? ""} onChange={(e) => set("base_url", e.target.value)} placeholder={defaults[kind]} />
          </Field>
        )}
        {kind !== "ollama" && (
          <div className="grid2">
            <Field label={`API key${KINDS[kind].needsKey ? "" : " (optional)"}`}>
              <select value={f.secret_id ?? ""} onChange={(e) => set("secret_id", e.target.value ? Number(e.target.value) : null)}>
                <option value="">{KINDS[kind].needsKey ? "Choose or paste a new key…" : "None"}</option>
                {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hint})</option>)}
              </select>
            </Field>
            <Field label="…or paste a new key"><SecretInput value={newKey} onChange={setNewKey} placeholder="stored encrypted" /></Field>
          </div>
        )}
        <Field label="Default model" hint={!models.length ? "Press Test connection to load the list."
          : f.default_model && !models.includes(f.default_model) ? <span className="error">"{f.default_model}" is not in this provider's list. Pick one or calls will fail.</span> : undefined}>
          <ModelPicker models={models} value={f.default_model ?? ""} onChange={(v) => set("default_model", v)} />
        </Field>
        {test && test !== "…" && <div className={`test-result ${test.ok ? "ok" : "bad"}`}>{test.ok ? "✓ " : "✗ "}{test.message}</div>}
        <p className="hint" style={{ marginTop: 10 }}>Prices are set per model under <a href="#/usage">Usage &amp; billing</a>, so each agent is billed at its own model's rate.</p>
        {error && <div className="error">{error}</div>}
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
      footer={<>{s.id && <button className="btn danger" onClick={remove}>Delete</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <Field label="Name"><NoFillInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={s.id ? "New value (leave empty to keep the current one)" : "Value"} hint="Encrypted on this machine; never shown again.">
        <SecretInput value={value} onChange={setValue} />
      </Field>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}
