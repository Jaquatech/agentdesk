import type { FastifyInstance } from "fastify";
import type { DB } from "./db.ts";
import { getSettings } from "./db.ts";
import type { AgentRow } from "./engines/types.ts";

/**
 * Teams decide who works on a chat: the chat's team, else its project's team.
 * With no team, every enabled agent is in play and Settings' default planner/reviewer lead (the old behaviour).
 */
export type TeamRow = { id: number; name: string; description: string; planner_id: number | null; reviewer_id: number | null;
  /** Scrum: the architect (a planner agent) and the security reviewer (a reviewer agent); empty = the team's planner / reviewer. */
  architect_id: number | null; security_id: number | null };
type Role = AgentRow["role"];

export function teamOfChat(db: DB, chatId: number): number | null {
  const r = db.prepare(`SELECT COALESCE(c.team_id, p.team_id) AS team_id FROM chats c JOIN projects p ON p.id = c.project_id WHERE c.id = ?`)
    .get(chatId) as { team_id: number | null } | undefined;
  return r?.team_id ?? null;
}

export function teamOfProject(db: DB, projectId: number | undefined): number | null {
  if (!projectId) return null;
  return (db.prepare("SELECT team_id FROM projects WHERE id = ?").get(projectId) as { team_id: number | null } | undefined)?.team_id ?? null;
}

export function team(db: DB, teamId: number | null): TeamRow | undefined {
  return teamId ? db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as TeamRow | undefined : undefined;
}

/** Enabled agents of a role in the team (or in the whole office when there is no team), oldest first. */
export function teamAgents(db: DB, teamId: number | null, role: Role): AgentRow[] {
  if (teamId && team(db, teamId)) {
    return db.prepare(`SELECT a.* FROM agents a JOIN team_members m ON m.agent_id = a.id
      WHERE m.team_id = ? AND a.role = ? AND a.enabled = 1 ORDER BY a.id`).all(teamId, role) as AgentRow[];
  }
  return db.prepare("SELECT * FROM agents WHERE role = ? AND enabled = 1 ORDER BY id").all(role) as AgentRow[];
}

/**
 * Who does a role's work: a named agent (planner's choice) from the team, else the explicitly given id
 * (a task that already has one), else the team's lead for the role, else the first of the role in the team.
 */
export function pickAgent(db: DB, role: Role, o: { teamId?: number | null; preferred?: number | null; name?: string } = {}): AgentRow | undefined {
  const all = teamAgents(db, o.teamId ?? null, role);
  if (o.name) {
    const byName = all.find((a) => a.name.toLowerCase() === o.name!.toLowerCase());
    if (byName) return byName;
  }
  if (o.preferred) {
    const pref = db.prepare("SELECT * FROM agents WHERE id = ? AND role = ? AND enabled = 1").get(o.preferred, role) as AgentRow | undefined;
    if (pref) return pref;
  }
  const t = team(db, o.teamId ?? null);
  const lead = t
    ? role === "planner" ? t.planner_id : role === "reviewer" ? t.reviewer_id : null
    : Number(getSettings(db)[`default_${role}_id`] || 0);
  return all.find((a) => a.id === lead) ?? all[0];
}

function teamsWithMembers(db: DB) {
  const teams = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM projects p WHERE p.team_id = t.id) AS project_count
    FROM teams t ORDER BY t.name`).all() as (TeamRow & { project_count: number })[];
  const members = db.prepare("SELECT team_id, agent_id FROM team_members").all() as { team_id: number; agent_id: number }[];
  return teams.map((t) => ({ ...t, member_ids: members.filter((m) => m.team_id === t.id).map((m) => m.agent_id) }));
}

/** Replaces an agent's teams. */
export function setAgentTeams(db: DB, agentId: number, teamIds: number[]) {
  db.transaction(() => {
    db.prepare("DELETE FROM team_members WHERE agent_id = ?").run(agentId);
    for (const t of new Set(teamIds)) db.prepare("INSERT OR IGNORE INTO team_members (team_id, agent_id) SELECT id, ? FROM teams WHERE id = ?").run(agentId, t);
    // A lead who left the team is no longer its lead.
    db.prepare(`UPDATE teams SET planner_id = NULL WHERE planner_id = ? AND id NOT IN (SELECT team_id FROM team_members WHERE agent_id = ?)`).run(agentId, agentId);
    db.prepare(`UPDATE teams SET reviewer_id = NULL WHERE reviewer_id = ? AND id NOT IN (SELECT team_id FROM team_members WHERE agent_id = ?)`).run(agentId, agentId);
    db.prepare(`UPDATE teams SET architect_id = NULL WHERE architect_id = ? AND id NOT IN (SELECT team_id FROM team_members WHERE agent_id = ?)`).run(agentId, agentId);
    db.prepare(`UPDATE teams SET security_id = NULL WHERE security_id = ? AND id NOT IN (SELECT team_id FROM team_members WHERE agent_id = ?)`).run(agentId, agentId);
  })();
}

type Body = Record<string, any>;

export function registerTeams(app: FastifyInstance, db: DB) {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const fields = (b: Body) => ({
    name: String(b.name ?? "").trim().slice(0, 60),
    description: String(b.description ?? "").slice(0, 500),
    planner_id: num(b.planner_id),
    reviewer_id: num(b.reviewer_id),
    architect_id: num(b.architect_id),
    security_id: num(b.security_id),
  });
  const save = (teamId: number | null, b: Body) => {
    const f = fields(b);
    if (!f.name) throw Object.assign(new Error("Name is required"), { status: 400 });
    const members = Array.isArray(b.member_ids) ? b.member_ids.map(Number).filter(Boolean) : null;
    return db.transaction(() => {
      let id = teamId;
      if (id) db.prepare("UPDATE teams SET name = ?, description = ? WHERE id = ?").run(f.name, f.description, id);
      else id = Number(db.prepare("INSERT INTO teams (name, description) VALUES (?, ?)").run(f.name, f.description).lastInsertRowid);
      if (members) {
        db.prepare("DELETE FROM team_members WHERE team_id = ?").run(id);
        for (const a of new Set(members)) db.prepare("INSERT OR IGNORE INTO team_members (team_id, agent_id) SELECT ?, id FROM agents WHERE id = ?").run(id, a);
      }
      // A lead must be a member with that role; anything else is cleared rather than refused.
      const lead = (agentId: number | null, role: Role) => agentId && db.prepare(`SELECT 1 FROM team_members m JOIN agents a ON a.id = m.agent_id
        WHERE m.team_id = ? AND a.id = ? AND a.role = ?`).get(id, agentId, role) ? agentId : null;
      db.prepare("UPDATE teams SET planner_id = ?, reviewer_id = ?, architect_id = ?, security_id = ? WHERE id = ?")
        .run(lead(f.planner_id, "planner"), lead(f.reviewer_id, "reviewer"), lead(f.architect_id, "planner"), lead(f.security_id, "reviewer"), id);
      return id!;
    })();
  };
  const fail = (reply: any, err: unknown) => {
    const e = err as Error & { status?: number };
    if (/UNIQUE/.test(e.message)) return reply.code(409).send({ error: "A team with that name already exists" });
    return reply.code(e.status ?? 500).send({ error: e.message });
  };

  app.get("/api/teams", async () => teamsWithMembers(db));
  app.post("/api/teams", async (req, reply) => {
    try {
      return { id: save(null, req.body as Body) };
    } catch (err) { return fail(reply, err); }
  });
  app.put("/api/teams/:id", async (req, reply) => {
    const id = Number((req.params as Body).id);
    if (!team(db, id)) return reply.code(404).send({ error: "Not found" });
    try { save(id, req.body as Body); return { ok: true }; } catch (err) { return fail(reply, err); }
  });
  app.delete("/api/teams/:id", async (req) => {
    // Projects and chats of a deleted team fall back to every agent (ON DELETE SET NULL).
    db.prepare("DELETE FROM teams WHERE id = ?").run(Number((req.params as Body).id));
    return { ok: true };
  });
}

/** Scrum roles: the architect (else the team's planner) and the security reviewer (else the team's reviewer). */
export function architectOf(db: DB, teamId: number | null): AgentRow | undefined {
  const t = team(db, teamId);
  const planners = teamAgents(db, teamId, "planner");
  return planners.find((a) => a.id === t?.architect_id) ?? pickAgent(db, "planner", { teamId });
}
export function securityOf(db: DB, teamId: number | null): AgentRow | undefined {
  const t = team(db, teamId);
  const reviewers = teamAgents(db, teamId, "reviewer");
  return reviewers.find((a) => a.id === t?.security_id) ?? pickAgent(db, "reviewer", { teamId });
}
