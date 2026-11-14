import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { ensureProjectPages } from "./documents.ts";
import { DEFAULT_WORKER_TOOLS } from "./engines/types.ts";
import { ROLE_TEMPLATES } from "./orchestrator/prompts.ts";

export const DEMO_PROVIDER = "Demo (scripted, no model)";
export const DEMO_MODEL = "demo-model";

const AGENTS = [
  { name: "Nova", role: "planner" },
  { name: "Orbit", role: "worker" },
  { name: "Comet", role: "worker" },
  { name: "Sentinel", role: "reviewer" },
] as const;

function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), "# Red Dust Gadgets\n\nImaginary gadgets for the first crew on Mars, built by a very small startup.\nNothing here is real, which is the point: it is a safe place to try AgentDesk.\n\n- dust-buddy: a pocket vacuum that keeps regolith out of the airlock\n- cocoa-printer: a 3D printer for hot chocolate (low gravity, no spills)\n- rover-radio: a playlist app that picks music by crater\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=AgentDesk Demo", "-c", "user.email=demo@localhost", ...args], { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Start the demo project");
}

/** Fills an empty demo database with a team and a Scrum project so every page has something to show. Returns false when data already exists. */
export function seedDemo(db: DB, dataDir: string): boolean {
  if ((db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n > 0) return false;
  const projectDir = join(dataDir, "demo-project");
  if (!existsSync(join(projectDir, ".git"))) {
    try { initRepo(projectDir); } catch { return false; }
  }
  const providerId = Number(db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES (?, 'ollama', 'http://localhost:11434', ?)").run(DEMO_PROVIDER, DEMO_MODEL).lastInsertRowid);
  const insertAgent = db.prepare(`INSERT INTO agents (name, role, provider_id, model, context, allowed_tools)
    VALUES (@name, @role, @provider_id, @model, @context, @allowed_tools)`);
  const ids = AGENTS.map((a) => Number(insertAgent.run({
    name: a.name, role: a.role, provider_id: providerId, model: DEMO_MODEL,
    context: ROLE_TEMPLATES[a.role], allowed_tools: JSON.stringify(a.role === "worker" ? DEFAULT_WORKER_TOOLS : []),
  }).lastInsertRowid));
  const teamId = Number(db.prepare("INSERT INTO teams (name, description, planner_id, reviewer_id) VALUES ('Mission Control', 'The Red Dust Gadgets crew (scripted, no model)', ?, ?)").run(ids[0], ids[3]).lastInsertRowid);
  for (const id of ids) db.prepare("INSERT INTO team_members (team_id, agent_id) VALUES (?, ?)").run(teamId, id);
  const projectId = Number(db.prepare(`INSERT INTO projects (name, source, path, base_branch, team_id, process)
    VALUES ('Red Dust Gadgets', 'local', ?, 'main', ?, 'scrum')`).run(projectDir, teamId).lastInsertRowid);
  ensureProjectPages(db, projectId);
  const insertItem = db.prepare(`INSERT INTO backlog_items (project_id, title, request, story, acceptance, tech_notes, points, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')`);
  [
    ["Dust Buddy: airlock dust alarm", "Beep when the airlock has too much dust.", "As a Mars colonist I want an alarm when dust builds up so that my suit seals stay clean.", "- [ ] An alarm threshold is configurable\n- [ ] A note explains how to test it", "## Approach (demo)\nOne small module under dust-buddy/.", 3],
    ["Cocoa Printer: marshmallow mode", "Add a marshmallow topping option to the cocoa printer.", "As a homesick astronaut I want marshmallows on my cocoa so that Mars feels a bit more like home.", "- [ ] Marshmallow count 0 to 5\n- [ ] Low gravity setting keeps them on top", "## Approach (demo)\nExtend cocoa-printer/ with a topping option.", 5],
    ["Rover Radio: crater playlists", "Suggest a playlist for each crater the rover passes.", "As a rover driver I want music that fits the crater so that long drives are fun.", "- [ ] Three craters have a playlist\n- [ ] Unknown craters get a default", "## Approach (demo)\nA lookup table under rover-radio/.", 2],
  ].forEach(([title, request, story, acceptance, notes, points], n) => insertItem.run(projectId, title, request, story, acceptance, notes, points, n + 1));
  return true;
}
