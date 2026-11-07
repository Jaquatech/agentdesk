import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { get, post, put, del, parseJson, type Agent, type Role, type Team } from "../api.ts";
import { Avatar, Field, Modal } from "../components/ui.tsx";
import { lookFor } from "../office/palette.ts";
import { NoFillInput } from "../components/inputs.tsx";

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
    <>
      <div className="page-head">
        <h1>Teams</h1><span className="spacer" />
        <button className="btn primary" onClick={() => setEditing({ name: "", description: "", member_ids: [] })}><Plus size={14} /> New team</button>
      </div>
      <div className="page"><div className="narrow">
        <div className="hint" style={{ marginBottom: 14 }}>
          A team's planner answers the chats of its projects and hands tasks only to the team's developers; its reviewer checks them.
          Pick a project's team under <a href="#/projects">Projects</a>; a chat can switch team in its header. Add agents under <a href="#/agents">Agents</a> (or from the gallery there).
        </div>
        {teams && teams.length === 0 && (
          <div className="card card-pad">No teams yet: projects use every enabled agent. Make a team to split the work, e.g. "Web" and "Integration".</div>
        )}
        {teams?.map((t) => (
          <div key={t.id} className="card team-card">
            <div className="team-head">
              <div style={{ minWidth: 0 }}>
                <b>{t.name}</b>
                <div className="hint">{t.description || "No description"} · {t.project_count} project{t.project_count === 1 ? "" : "s"}</div>
              </div>
              <span className="spacer" />
              <button className="btn small" onClick={() => setEditing(t)}><Pencil size={13} /> Edit</button>
            </div>
            <div className="team-roles">
              {ROLES.map(({ role, label }) => {
                const members = agents.filter((a) => a.role === role && t.member_ids.includes(a.id));
                const lead = role === "planner" ? t.planner_id : role === "reviewer" ? t.reviewer_id : null;
                return (
                  <div key={role}>
                    <div className="hint">{label}</div>
                    {members.length === 0 && <div className={role === "worker" || role === "planner" ? "error" : "hint"}>{role === "reviewer" ? "none: tasks are approved after the checks" : "none"}</div>}
                    {members.map((a) => (
                      <div key={a.id} className="team-member" style={{ opacity: a.enabled ? 1 : 0.5 }}>
                        <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={24} />
                        <span className="ellipsis">{a.name}</span>
                        {lead === a.id && members.length > 1 && <span className="badge accent">lead</span>}
                        {!a.enabled && <span className="badge">off</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div></div>
      {editing && <TeamForm team={editing} agents={agents} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
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
    <select value={value ?? ""} onChange={(e) => set(e.target.value ? Number(e.target.value) : null)}>
      <option value="">First {role} in the team</option>
      {inTeam(role).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );

  return (
    <Modal title={team.id ? `Edit ${team.name}` : "New team"} onClose={onClose} wide
      footer={<>
        {team.id && <button className="btn danger" onClick={remove}>Delete</button>}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </>}>
      <div className="grid2">
        <Field label="Name"><NoFillInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Web" /></Field>
        <Field label="Description"><NoFillInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team works on" /></Field>
      </div>
      <div className="hint" style={{ margin: "4px 0 8px" }}>Members. An agent can be in several teams; it still has one desk and does one task at a time.</div>
      <div className="team-pick">
        {ROLES.map(({ role, label }) => (
          <div key={role}>
            <div className="hint">{label}</div>
            {agents.filter((a) => a.role === role).length === 0 && <div className="hint">No {label.toLowerCase()} agents yet.</div>}
            {agents.filter((a) => a.role === role).map((a) => (
              <label key={a.id} className="team-member clickable">
                <input type="checkbox" checked={members.includes(a.id)} onChange={() => toggle(a.id)} />
                <Avatar look={lookFor(a.name, parseJson(a.appearance, {}))} size={24} />
                <span className="ellipsis">{a.name}{!a.enabled && " (off)"}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <Field label="Planner that answers the chats">{leadPick("planner", planner, setPlanner)}</Field>
        <Field label="Reviewer that checks the tasks">{leadPick("reviewer", reviewer, setReviewer)}</Field>
      </div>
      <div className="hint" style={{ margin: "4px 0 8px" }}>
        For projects that run Scrum: the planner is the product manager. Pick a planner as architect and a reviewer for the security review, or leave them as the team's own.
      </div>
      <div className="grid2">
        <Field label="Architect (technical notes on backlog items)">{leadPick("planner", architect, setArchitect)}</Field>
        <Field label="Security reviewer (end of a sprint)">{leadPick("reviewer", security, setSecurity)}</Field>
      </div>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}
