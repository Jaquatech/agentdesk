import { useEffect, useState } from "react";
import { Plus, Store } from "lucide-react";
import { get, post, put, del, parseJson, type Agent, type Appearance, type Provider, type Role, type Team } from "../api.ts";
import { Avatar, Field, FooterGap, Modal } from "../components/ui.tsx";
import { HAIRS, SHIRTS, SKINS, lookFor } from "../office/palette.ts";
import { Choice, ModelPicker, NoFillInput } from "../components/inputs.tsx";
import { CapabilityBadges, useCapabilities } from "../components/Capabilities.tsx";
import { ModelAdvice } from "../components/ModelAdvice.tsx";
import { Page, Section } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
    <Page title="Agents" actions={<Button onClick={() => setGallery(true)} disabled={!templates}><Store data-icon="inline-start" /> Add from gallery</Button>}>
      {providers.length === 0 && (
        <Card><div className="px-4 text-sm">Add a provider first under <a href="#/providers">Providers &amp; keys</a>: agents call models through it.</div></Card>
      )}
      {(["planner", "worker", "reviewer"] as Role[]).map((role) => (
        <Section key={role} title={ROLE_INFO[role].label} hint={ROLE_INFO[role].text}
          action={<Button variant="outline" onClick={() => startNew(role)} disabled={!templates}><Plus data-icon="inline-start" /> New</Button>}>
          <Card className="gap-0 py-0">
            {agents.filter((a) => a.role === role).length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">None yet.</div>}
            {agents.filter((a) => a.role === role).map((a) => (
              <button key={a.id} type="button" className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted" style={{ opacity: a.enabled ? 1 : 0.5 }} onClick={() => setEditing(a)}>
                <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={36} />
                <div className="min-w-0">
                  <b>{a.name}</b>{!a.enabled && <Badge variant="secondary" className="ml-2">off</Badge>}
                  {" "}{teams.filter((t) => a.team_ids?.includes(t.id)).map((t) => <Badge key={t.id} variant="outline" className="mr-1 border-primary/40 text-primary-text">{t.name}</Badge>)}
                  <div className="text-xs text-muted-foreground">{a.provider_name ?? "no provider"} · <span className="font-mono">{a.model || "provider default"}</span></div>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{a.max_turns} turns · {a.timeout_min} min</span>
              </button>
            ))}
          </Card>
        </Section>
      ))}
      {gallery && <GalleryModal onClose={() => setGallery(false)} onPick={fromGallery} />}
      {editing && <AgentForm agent={editing} providers={providers} teams={teams} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}
        onDuplicate={(copy) => { setEditing(null); setTimeout(() => setEditing(copy), 0); }} />}
    </Page>
  );
}

function AgentForm({ agent, providers, teams, onClose, onSaved, onDuplicate }: {
  agent: Partial<Agent>; providers: Provider[]; teams: Team[]; onClose: () => void; onSaved: () => void;
  onDuplicate: (copy: Partial<Agent>) => void;
}) {
  const [f, setF] = useState({ ...agent });
  const [look, setLook] = useState<Appearance>(parseJson(agent.appearance, {}));
  const [tools, setTools] = useState(parseJson<string[]>(agent.allowed_tools, []).join("\n"));
  const [modelsFor, setModelsFor] = useState<{ providerId: number; models: string[] } | null>(null);
  const [error, setError] = useState("");
  const [teamIds, setTeamIds] = useState<number[]>(agent.team_ids ?? []);
  const provider = providers.find((p) => p.id === Number(f.provider_id));
  const models = provider && modelsFor?.providerId === provider.id ? modelsFor.models : [];
  const caps = useCapabilities(provider ? `/api/providers/${provider.id}/capabilities?model=${encodeURIComponent(f.model || provider.default_model || "")}` : null);
  const set = (k: keyof Agent, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!provider) return;
    post<{ ok: boolean; models?: string[] }>(`/api/providers/${provider.id}/test`).then((r) => setModelsFor({ providerId: provider.id, models: r.models ?? [] })).catch(() => {});
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
        {agent.id && <Button variant="destructive" onClick={remove}>Delete</Button>}
        {agent.id && <Button variant="outline" title="New agent with the same settings and a new name" onClick={() => {
          const rest = { ...agent, ...f, appearance: JSON.stringify({}), allowed_tools: JSON.stringify(tools.split("\n").map((x) => x.trim()).filter(Boolean)) };
          delete rest.id;
          onDuplicate({ ...rest, name: nextName(agent.name ?? "Agent") });
        }}>Duplicate</Button>}
        <FooterGap />
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </>}>
      <div className="flex flex-col items-start gap-5 sm:flex-row">
        <div className="flex w-40 flex-col items-center gap-2">
          <Avatar look={preview} size={96} />
          <Swatches label="Shirt" colors={SHIRTS} current={preview.shirt} onPick={(c) => setLook({ ...look, shirt: c })} />
          <Swatches label="Hair" colors={HAIRS} current={preview.hair} onPick={(c) => setLook({ ...look, hair: c })} />
          <Swatches label="Skin" colors={SKINS} current={preview.skin} onPick={(c) => setLook({ ...look, skin: c })} />
          <Button variant="outline" size="sm" onClick={() => setLook({ ...look, hairStyle: ((preview.hairStyle ?? 0) + 1) % 4 })}>Change hairstyle</Button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><NoFillInput value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Aino" /></Field>
            <Field label="Type">
              <Choice value={String(f.role ?? "planner")} onValueChange={(v) => set("role", v)} options={(Object.keys(ROLE_INFO) as Role[]).map((r) => ({ value: r, label: ROLE_INFO[r].label }))} />
            </Field>
            <Field label="Provider (which API and key)">
              <Choice value={f.provider_id ? String(f.provider_id) : ""} onValueChange={(v) => set("provider_id", v ? Number(v) : null)}
                options={[{ value: "", label: "Choose…" }, ...providers.map((p) => ({ value: String(p.id), label: `${p.name} (${p.kind})` }))]} />
            </Field>
            <Field label="Model" hint={provider && !models.length ? "Loading the provider's models…" : undefined}>
              <ModelPicker models={models} value={f.model ?? ""} onChange={(v) => set("model", v)} allowDefault
                defaultLabel={`Provider default${provider?.default_model ? ` (${provider.default_model})` : ""}`} />
              <CapabilityBadges caps={caps} role={f.role} />
            </Field>
            <Field label="Thinking" hint={f.thinking === "off" ? "Answers right away: much faster on local models." : "Reasoning models (Qwen3, gpt-oss, DeepSeek-R1) think before each answer; small ones can use the whole answer limit on it."}>
              <Choice value={f.thinking ?? ""} onValueChange={(v) => set("thinking", v)} options={[{ value: "", label: "Model default" }, { value: "off", label: "Off (or as little as the model allows)" }]} />
            </Field>
            {provider && f.role && (
              <ModelAdvice kind={provider.kind} models={models} role={f.role} context={f.context ?? ""} value={f.model ?? ""} onPick={(m) => set("model", m)} />
            )}
            <Field label="Max turns"><Input type="number" value={f.max_turns ?? 80} onChange={(e) => set("max_turns", Number(e.target.value))} /></Field>
            <Field label="Timeout (minutes)"><Input type="number" value={f.timeout_min ?? 60} onChange={(e) => set("timeout_min", Number(e.target.value))} /></Field>
          </div>
          <Field label="Starting context" hint="The agent's standing instructions. Project notes are added after it.">
            <Textarea className="min-h-40 font-mono text-xs" rows={10} value={f.context ?? ""} onChange={(e) => set("context", e.target.value)} />
          </Field>
          {f.role === "worker" && (
            <Field label="Allowed tools and commands (one per line)" hint={<>Same syntax as Claude Code: <code>Read</code>, <code>Edit</code>, <code>Bash(npm test:*)</code>. Planners and reviewers are always read-only.</>}>
              <Textarea className="min-h-28 font-mono text-xs" rows={6} value={tools} onChange={(e) => setTools(e.target.value)} />
            </Field>
          )}
          <Field label="Teams" hint={teams.length ? "The agent works for every team it is in." : undefined}>
            {teams.length === 0 ? <span className="text-sm text-muted-foreground">No teams yet: every enabled agent works on every project. <a href="#/teams">Make a team</a>.</span> : (
              <div className="flex flex-wrap gap-3">
                {teams.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={teamIds.includes(t.id)} onCheckedChange={(v) => setTeamIds((ids) => v === true ? [...ids, t.id] : ids.filter((x) => x !== t.id))} /> {t.name}
                  </label>
                ))}
              </div>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.ask_approval !== 0} onCheckedChange={(v) => set("ask_approval", v === true ? 1 : 0)} />
            Ask me before a command outside the list (the run waits for your answer; off = refuse it automatically)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.enabled !== 0} onCheckedChange={(v) => set("enabled", v === true ? 1 : 0)} /> Enabled (has a desk in the office and can take work)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}

function Swatches({ label, colors, current, onPick }: { label: string; colors: string[]; current: string; onPick: (c: string) => void }) {
  return (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {colors.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => onPick(c)} className={cn("size-5 rounded-full", current === c && "ring-2 ring-foreground")} style={{ background: c }} />
        ))}
      </div>
    </>
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
  const cats = [{ id: "all", label: "All" }, ...(g?.categories ?? [])];
  return (
    <Modal title="Add an agent from the gallery" onClose={onClose} wide>
      <Tabs value={cat} onValueChange={setCat}>
        <TabsList className="flex h-auto flex-wrap">
          {cats.map((c) => <TabsTrigger key={c.id} value={c.id}>{c.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <NoFillInput type="search" placeholder="Search by name or what it does" value={q} onChange={(e) => setQ(e.target.value)} />
      {!g && <p className="text-sm text-muted-foreground">Loading…</p>}
      {g && !items.length && <p className="text-sm text-muted-foreground">No agent matches.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <Card key={i.id} className="gap-2">
            <div className="flex items-center gap-2 px-4">
              <Avatar look={lookFor(i.name, {})} size={32} />
              <div className="min-w-0"><b>{i.title}</b><div className="text-xs text-muted-foreground">{i.name}</div></div>
            </div>
            <p className="px-4 text-sm">{i.summary}</p>
            {i.note && <p className="px-4 text-xs text-muted-foreground">{i.note}</p>}
            <div className="mt-auto flex items-center gap-2 px-4">
              <Badge variant="secondary">{ROLE_BADGE[i.role]}</Badge>
              <Button className="ml-auto" size="sm" onClick={() => onPick(i)}><Plus data-icon="inline-start" /> Add</Button>
            </div>
          </Card>
        ))}
      </div>
    </Modal>
  );
}

function nextName(name: string) {
  const m = /^(.*?)(\d+)$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name} 2`;
}
