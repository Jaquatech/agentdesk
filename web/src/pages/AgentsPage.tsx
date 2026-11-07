import { useEffect, useState } from "react";
import { Plus, Store } from "lucide-react";
import { get, post, put, del, parseJson, type Agent, type Appearance, type Provider, type Role, type Team } from "../api.ts";
import { Avatar, Field, Modal } from "../components/ui.tsx";
import { HAIRS, SHIRTS, SKINS, lookFor } from "../office/palette.ts";
import { ModelPicker, NoFillInput } from "../components/inputs.tsx";
import { CapabilityBadges, useCapabilities } from "../components/Capabilities.tsx";
import { ModelAdvice } from "../components/ModelAdvice.tsx";

const ROLE_INFO: Record<Role, { label: string; text: string }> = {
  planner: { label: "Planner / architect", text: "Reads the code and your message, answers, and splits work into tasks." },
  worker: { label: "Developer", text: "Builds one task at a time in its own branch and worktree." },
  reviewer: { label: "Reviewer / QA", text: "Reads each finished branch and approves it or asks for fixes." },
};

type Templates = { contexts: Record<Role, string>; workerTools: string[] };
type GalleryItem = {
  id: string; category: string; title: string; name: string; role: Role; summary: string; context: string;
  allowed_tools: string[]; max_turns: number; timeout_min: number; note?: string;
};
type Gallery = { categories: { id: string; label: string }[]; items: GalleryItem[] };

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [editing, setEditing] = useState<Partial<Agent> | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [gallery, setGallery] = useState(false);

  const load = () => { get<Agent[]>("/api/agents").then(setAgents); get<Team[]>("/api/teams").then(setTeams); };
  useEffect(() => {
    load();
    get<{ providers: Provider[] }>("/api/providers").then((d) => setProviders(d.providers));
    get<Templates>("/api/agents/templates").then(setTemplates);
  }, []);

  const startNew = (role: Role) => setEditing({
    role, name: "", provider_id: providers[0]?.id ?? null, model: "", context: templates?.contexts[role] ?? "",
    max_turns: role === "worker" ? 120 : 40, timeout_min: role === "worker" ? 60 : 20,
    allowed_tools: JSON.stringify(role === "worker" ? templates?.workerTools ?? [] : []), appearance: "{}", enabled: 1,
    team_ids: teams.length === 1 ? [teams[0].id] : [],
  });
  const fromGallery = (g: GalleryItem) => {
    setGallery(false);
    const taken = new Set(agents.map((a) => a.name.toLowerCase()));
    let name = g.name;
    while (taken.has(name.toLowerCase())) name = nextName(name);
    setEditing({
      role: g.role, name, provider_id: providers[0]?.id ?? null, model: "", context: g.context,
      max_turns: g.max_turns, timeout_min: g.timeout_min, allowed_tools: JSON.stringify(g.allowed_tools), appearance: "{}", enabled: 1,
      team_ids: teams.length === 1 ? [teams[0].id] : [],
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>Agents</h1><span className="spacer" />
        <button className="btn primary" onClick={() => setGallery(true)} disabled={!templates}><Store size={14} /> Add from gallery</button>
      </div>
      <div className="page"><div className="narrow">
        {providers.length === 0 && (
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            Add a provider first under <a href="#/providers">Providers &amp; keys</a>: agents call models through it.
          </div>
        )}
        {(["planner", "worker", "reviewer"] as Role[]).map((role) => (
          <div key={role}>
            <div className="section-title">
              <div><h2>{ROLE_INFO[role].label}</h2><div className="hint">{ROLE_INFO[role].text}</div></div>
              <span className="spacer" />
              <button className="btn" onClick={() => startNew(role)} disabled={!templates}><Plus size={14} /> New</button>
            </div>
            <div className="list">
              {agents.filter((a) => a.role === role).length === 0 && <div className="list-row hint">None yet.</div>}
              {agents.filter((a) => a.role === role).map((a) => (
                <div key={a.id} className="list-row clickable" onClick={() => setEditing(a)} style={{ opacity: a.enabled ? 1 : 0.5 }}>
                  <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <b>{a.name}</b>{!a.enabled && <span className="badge" style={{ marginLeft: 8 }}>off</span>}
                    {" "}<span className="team-badges">{teams.filter((t) => a.team_ids?.includes(t.id)).map((t) => <span key={t.id} className="badge accent">{t.name}</span>)}</span>
                    <div className="hint">{a.provider_name ?? "no provider"} · <span className="mono">{a.model || "provider default"}</span></div>
                  </div>
                  <span className="spacer" />
                  <span className="hint">{a.max_turns} turns · {a.timeout_min} min</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div></div>
      {gallery && <GalleryModal onClose={() => setGallery(false)} onPick={fromGallery} />}
      {editing && <AgentForm agent={editing} providers={providers} teams={teams} templates={templates!} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}
        onDuplicate={(copy) => { setEditing(null); setTimeout(() => setEditing(copy), 0); }} />}
    </>
  );
}

function AgentForm({ agent, providers, teams, templates, onClose, onSaved, onDuplicate }: {
  agent: Partial<Agent>; providers: Provider[]; teams: Team[]; templates: Templates; onClose: () => void; onSaved: () => void;
  onDuplicate: (copy: Partial<Agent>) => void;
}) {
  const [f, setF] = useState({ ...agent });
  const [look, setLook] = useState<Appearance>(parseJson(agent.appearance, {}));
  const [tools, setTools] = useState(parseJson<string[]>(agent.allowed_tools, []).join("\n"));
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [teamIds, setTeamIds] = useState<number[]>(agent.team_ids ?? []);
  const provider = providers.find((p) => p.id === Number(f.provider_id));
  const caps = useCapabilities(provider ? `/api/providers/${provider.id}/capabilities?model=${encodeURIComponent(f.model || provider.default_model || "")}` : null);
  const set = (k: keyof Agent, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    setModels([]);
    if (!provider) return;
    post<{ ok: boolean; models?: string[] }>(`/api/providers/${provider.id}/test`).then((r) => setModels(r.models ?? [])).catch(() => {});
  }, [provider?.id]);

  const save = async () => {
    setError("");
    const body = {
      ...f, appearance: look, enabled: f.enabled !== 0,
      allowed_tools: tools.split("\n").map((s) => s.trim()).filter(Boolean),
      team_ids: teamIds,
    };
    try {
      if (agent.id) await put(`/api/agents/${agent.id}`, body);
      else await post("/api/agents", body);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`Delete ${agent.name}?`)) return;
    await del(`/api/agents/${agent.id}`);
    onSaved();
  };

  const preview = lookFor(f.name || "new", look);
  return (
    <Modal title={agent.id ? `Edit ${agent.name}` : `New ${ROLE_INFO[f.role as Role].label.toLowerCase()}`} onClose={onClose} wide
      footer={<>
        {agent.id && <button className="btn danger" onClick={remove}>Delete</button>}
        {agent.id && <button className="btn" title="New agent with the same settings and a new name" onClick={() => {
          const { id: _id, ...rest } = { ...agent, ...f, appearance: JSON.stringify({}), allowed_tools: JSON.stringify(tools.split("\n").map((x) => x.trim()).filter(Boolean)) };
          onDuplicate({ ...rest, name: nextName(agent.name ?? "Agent") });
        }}>Duplicate</button>}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </>}>
      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        <div style={{ display: "grid", gap: 10, justifyItems: "center", width: 150 }}>
          <Avatar look={preview} size={96} />
          <div className="hint">Shirt</div>
          <div className="color-pick">{SHIRTS.map((c) => <button key={c} className={preview.shirt === c ? "on" : ""} style={{ background: c }} onClick={() => setLook({ ...look, shirt: c })} aria-label={`shirt ${c}`} />)}</div>
          <div className="hint">Hair</div>
          <div className="color-pick">{HAIRS.map((c) => <button key={c} className={preview.hair === c ? "on" : ""} style={{ background: c }} onClick={() => setLook({ ...look, hair: c })} aria-label={`hair ${c}`} />)}</div>
          <div className="hint">Skin</div>
          <div className="color-pick">{SKINS.map((c) => <button key={c} className={preview.skin === c ? "on" : ""} style={{ background: c }} onClick={() => setLook({ ...look, skin: c })} aria-label={`skin ${c}`} />)}</div>
          <button className="btn small" onClick={() => setLook({ ...look, hairStyle: ((preview.hairStyle ?? 0) + 1) % 4 })}>Change hairstyle</button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="grid2">
            <Field label="Name"><NoFillInput value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Aino" /></Field>
            <Field label="Type">
              <select value={f.role} onChange={(e) => set("role", e.target.value)}>
                {(Object.keys(ROLE_INFO) as Role[]).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
              </select>
            </Field>
            <Field label="Provider (which API and key)">
              <select value={f.provider_id ?? ""} onChange={(e) => set("provider_id", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Choose…</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}
              </select>
            </Field>
            <Field label="Model" hint={provider && !models.length ? "Loading the provider's models…" : undefined}>
              <ModelPicker models={models} value={f.model ?? ""} onChange={(v) => set("model", v)} allowDefault
                defaultLabel={`Provider default${provider?.default_model ? ` (${provider.default_model})` : ""}`} />
              <CapabilityBadges caps={caps} role={f.role} />
            </Field>
            <Field label="Thinking" hint={f.thinking === "off" ? "Answers right away: much faster on local models." : "Reasoning models (Qwen3, gpt-oss, DeepSeek-R1) think before each answer; small ones can use the whole answer limit on it."}>
              <select value={f.thinking ?? ""} onChange={(e) => set("thinking", e.target.value)}>
                <option value="">Model default</option>
                <option value="off">Off (or as little as the model allows)</option>
              </select>
            </Field>
            <span />
            {provider && f.role && (
              <ModelAdvice kind={provider.kind} models={models} role={f.role} context={f.context ?? ""} value={f.model ?? ""} onPick={(m) => set("model", m)} />
            )}
            <Field label="Max turns"><input type="number" value={f.max_turns ?? 80} onChange={(e) => set("max_turns", Number(e.target.value))} /></Field>
            <Field label="Timeout (minutes)"><input type="number" value={f.timeout_min ?? 60} onChange={(e) => set("timeout_min", Number(e.target.value))} /></Field>
          </div>
          <Field label="Starting context" hint="The agent's standing instructions. Project notes are added after it.">
            <textarea className="mono" rows={10} value={f.context ?? ""} onChange={(e) => set("context", e.target.value)} />
          </Field>
          {f.role === "worker" && (
            <Field label="Allowed tools and commands (one per line)" hint={<>Same syntax as Claude Code: <code>Read</code>, <code>Edit</code>, <code>Bash(npm test:*)</code>. Planners and reviewers are always read-only.</>}>
              <textarea className="mono" rows={6} value={tools} onChange={(e) => setTools(e.target.value)} />
            </Field>
          )}
          <Field label="Teams" hint={teams.length ? "The agent works for every team it is in." : undefined}>
            {teams.length === 0 ? <span className="hint">No teams yet: every enabled agent works on every project. <a href="#/teams">Make a team</a>.</span> : (
              <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
                {teams.map((t) => (
                  <label key={t.id} className="row" style={{ gap: 6 }}>
                    <input type="checkbox" checked={teamIds.includes(t.id)}
                      onChange={(e) => setTeamIds((ids) => e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id))} /> {t.name}
                  </label>
                ))}
              </div>
            )}
          </Field>
          <label className="row" style={{ gap: 8, marginBottom: 6 }}>
            <input type="checkbox" checked={f.ask_approval !== 0} onChange={(e) => set("ask_approval", e.target.checked ? 1 : 0)} />
            Ask me before a command outside the list (the run waits for your answer; off = refuse it automatically)
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={f.enabled !== 0} onChange={(e) => set("enabled", e.target.checked ? 1 : 0)} /> Enabled (has a desk in the office and can take work)
          </label>
          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </Modal>
  );
}

const ROLE_BADGE: Record<Role, string> = { planner: "Planner", worker: "Developer", reviewer: "Reviewer" };

/** Ready-made agents: picking one opens the new-agent form filled in; provider and model are still yours to choose. */
function GalleryModal({ onClose, onPick }: { onClose: () => void; onPick: (g: GalleryItem) => void }) {
  const [g, setG] = useState<Gallery | null>(null);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  useEffect(() => { get<Gallery>("/api/agents/gallery").then(setG); }, []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = g?.items.filter((i) => (cat === "all" || i.category === cat)
    && words.every((w) => `${i.title} ${i.name} ${i.summary} ${i.category}`.toLowerCase().includes(w))) ?? [];
  return (
    <Modal title="Add an agent from the gallery" onClose={onClose} wide>
      <div className="tabs gallery-tabs" style={{ marginLeft: 0 }}>
        {[{ id: "all", label: "All" }, ...(g?.categories ?? [])].map((c) => (
          <button key={c.id} className={`tab ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      <NoFillInput type="search" placeholder="Search by name or what it does" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {!g && <div className="hint">Loading…</div>}
      {g && !items.length && <div className="hint">No agent matches.</div>}
      <div className="gallery-grid">
        {items.map((i) => (
          <div key={i.id} className="gallery-item">
            <div className="row">
              <Avatar look={lookFor(i.name, {})} size={32} />
              <div style={{ minWidth: 0 }}><b>{i.title}</b><div className="hint">{i.name}</div></div>
            </div>
            <p>{i.summary}</p>
            {i.note && <div className="hint">{i.note}</div>}
            <span className="spacer" />
            <div className="row">
              <span className="badge">{ROLE_BADGE[i.role]}</span>
              <span className="spacer" />
              <button className="btn small primary" onClick={() => onPick(i)}><Plus size={13} /> Add</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function nextName(name: string) {
  const m = /^(.*?)(\d+)$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name} 2`;
}
