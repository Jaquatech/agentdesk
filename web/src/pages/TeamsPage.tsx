import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { get, post, put, del, parseJson, type Agent, type Role, type Team } from "../api.ts";
import { Avatar, Field, FooterGap, Modal } from "../components/ui.tsx";
import { lookFor } from "../office/palette.ts";
import { Choice, NoFillInput } from "../components/inputs.tsx";
import { Page } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const ROLES: { role: Role; label: string }[] = [
  { role: "planner", label: "Planner" },
  { role: "worker", label: "Developers" },
  { role: "reviewer", label: "Reviewer" },
];

/** Teams: who plans, builds and reviews. A project picks its team; an agent can be in several teams. */
export function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editing, setEditing] = useState<Partial<Team> | null>(null);
  const load = () => {
    get<Team[]>("/api/teams").then(setTeams);
    get<Agent[]>("/api/agents").then(setAgents);
  };
  useEffect(load, []);

  return (
    <Page title="Teams" actions={<Button onClick={() => setEditing({ name: "", description: "", member_ids: [] })}><Plus data-icon="inline-start" /> New team</Button>}>
      <p className="text-sm text-muted-foreground">
        A team's planner answers the chats of its projects and hands tasks only to the team's developers; its reviewer checks them.
        Pick a project's team under <a href="#/projects">Projects</a>; a chat can switch team in its header. Add agents under <a href="#/agents">Agents</a> (or from the gallery there).
      </p>
      {teams && teams.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No teams yet</EmptyTitle>
            <EmptyDescription>Projects use every enabled agent. Make a team to split the work, e.g. "Web" and "Integration".</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {teams?.map((t) => (
        <Card key={t.id} className="gap-0 py-0">
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <b>{t.name}</b>
              <div className="text-xs text-muted-foreground">{t.description || "No description"} · {t.project_count} project{t.project_count === 1 ? "" : "s"}</div>
            </div>
            <Button className="ml-auto" size="sm" variant="outline" onClick={() => setEditing(t)}><Pencil data-icon="inline-start" /> Edit</Button>
          </div>
          <CardContent className="grid gap-4 py-3 sm:grid-cols-3">
            {ROLES.map(({ role, label }) => {
              const members = agents.filter((a) => a.role === role && t.member_ids.includes(a.id));
              const lead = role === "planner" ? t.planner_id : role === "reviewer" ? t.reviewer_id : null;
              return (
                <div key={role}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  {members.length === 0 && <div className={role === "worker" || role === "planner" ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>{role === "reviewer" ? "none: tasks are approved after the checks" : "none"}</div>}
                  {members.map((a) => (
                    <div key={a.id} className="flex min-w-0 items-center gap-2 py-0.5 text-sm" style={{ opacity: a.enabled ? 1 : 0.5 }}>
                      <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={24} />
                      <span className="truncate">{a.name}</span>
                      {lead === a.id && members.length > 1 && <Badge variant="outline" className="border-primary/40 text-primary">lead</Badge>}
                      {!a.enabled && <Badge variant="secondary">off</Badge>}
                    </div>
                  ))}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
      {editing && <TeamForm team={editing} agents={agents} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Page>
  );
}

function TeamForm({ team, agents, onClose, onSaved }: { team: Partial<Team>; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(team.name ?? "");
  const [description, setDescription] = useState(team.description ?? "");
  const [members, setMembers] = useState<number[]>(team.member_ids ?? []);
  const [planner, setPlanner] = useState<number | null>(team.planner_id ?? null);
  const [reviewer, setReviewer] = useState<number | null>(team.reviewer_id ?? null);
  const [architect, setArchitect] = useState<number | null>(team.architect_id ?? null);
  const [security, setSecurity] = useState<number | null>(team.security_id ?? null);
  const [error, setError] = useState("");
  const toggle = (id: number) => setMembers((m) => m.includes(id) ? m.filter((x) => x !== id) : [...m, id]);
  const inTeam = (role: Role) => agents.filter((a) => a.role === role && members.includes(a.id));

  const save = async () => {
    setError("");
    const body = { name, description, member_ids: members, planner_id: planner, reviewer_id: reviewer, architect_id: architect, security_id: security };
    try {
      if (team.id) await put(`/api/teams/${team.id}`, body);
      else await post("/api/teams", body);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`Delete team ${team.name}? Its projects then use every enabled agent until you pick another team. The agents stay.`)) return;
    await del(`/api/teams/${team.id}`);
    onSaved();
  };
  const leadPick = (role: Role, value: number | null, set: (v: number | null) => void) => (
    <Choice value={value ? String(value) : ""} onValueChange={(v) => set(v ? Number(v) : null)}
      options={[{ value: "", label: `First ${role} in the team` }, ...inTeam(role).map((a) => ({ value: String(a.id), label: a.name }))]} />
  );

  return (
    <Modal title={team.id ? `Edit ${team.name}` : "New team"} onClose={onClose} wide
      footer={<>
        {team.id && <Button variant="destructive" onClick={remove}>Delete</Button>}
        <FooterGap />
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><NoFillInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Web" /></Field>
        <Field label="Description"><NoFillInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team works on" /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Members. An agent can be in several teams; it still has one desk and does one task at a time.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {ROLES.map(({ role, label }) => (
          <div key={role} className="flex flex-col gap-1">
            <div className="text-xs text-muted-foreground">{label}</div>
            {agents.filter((a) => a.role === role).length === 0 && <div className="text-xs text-muted-foreground">No {label.toLowerCase()} agents yet.</div>}
            {agents.filter((a) => a.role === role).map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                <Checkbox checked={members.includes(a.id)} onCheckedChange={() => toggle(a.id)} />
                <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={24} />
                <span className="truncate">{a.name}{!a.enabled && " (off)"}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Planner that answers the chats">{leadPick("planner", planner, setPlanner)}</Field>
        <Field label="Reviewer that checks the tasks">{leadPick("reviewer", reviewer, setReviewer)}</Field>
      </div>
      <p className="text-xs text-muted-foreground">
        For projects that run Scrum: the planner is the product manager. Pick a planner as architect and a reviewer for the security review, or leave them as the team's own.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Architect (technical notes on backlog items)">{leadPick("planner", architect, setArchitect)}</Field>
        <Field label="Security reviewer (end of a sprint)">{leadPick("reviewer", security, setSecurity)}</Field>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
