import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { importDataset } from "./dataFactory/datasets.ts";
import { demoAnswer } from "./dataFactory/evalCall.ts";
import { DEFAULT_RUBRIC } from "./dataFactory/judge.ts";
import { demoJudgeReply } from "./dataFactory/judgeRunner.ts";
import { ensureProjectPages, syncReleasePage, syncTaskPage } from "./documents.ts";
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
  git("branch", "sprint/2-settling-in");
}

/** Fills an empty demo database with a team and a Scrum project so every page has something to show. Returns false when data already exists. */
export function seedDemo(db: DB, dataDir: string): boolean {
  if ((db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n > 0) return false;
  const projectDir = join(dataDir, "demo-project");
  if (!existsSync(join(projectDir, ".git"))) {
    try { initRepo(projectDir); } catch { return false; }
  }
  const providerId = Number(db.prepare("INSERT INTO providers (name, kind, base_url, default_model) VALUES (?, 'ollama', 'http://localhost:11434', ?)").run(DEMO_PROVIDER, DEMO_MODEL).lastInsertRowid);
  // Orbit never asks before a command, so the sprint's queued task runs without waiting for you. Comet asks: retry the Cocoa task to see the approval flow.
  const insertAgent = db.prepare(`INSERT INTO agents (name, role, provider_id, model, context, allowed_tools, ask_approval)
    VALUES (@name, @role, @provider_id, @model, @context, @allowed_tools, @ask_approval)`);
  const ids = AGENTS.map((a) => Number(insertAgent.run({
    name: a.name, role: a.role, provider_id: providerId, model: DEMO_MODEL,
    context: ROLE_TEMPLATES[a.role], allowed_tools: JSON.stringify(a.role === "worker" ? DEFAULT_WORKER_TOOLS : []), ask_approval: a.name === "Orbit" ? 0 : 1,
  }).lastInsertRowid));
  const teamId = Number(db.prepare("INSERT INTO teams (name, description, planner_id, reviewer_id) VALUES ('Mission Control', 'The Red Dust Gadgets crew (scripted, no model)', ?, ?)").run(ids[0], ids[3]).lastInsertRowid);
  for (const id of ids) db.prepare("INSERT INTO team_members (team_id, agent_id) VALUES (?, ?)").run(teamId, id);
  const projectId = Number(db.prepare(`INSERT INTO projects (name, source, path, base_branch, team_id, process)
    VALUES ('Red Dust Gadgets', 'local', ?, 'main', ?, 'scrum')`).run(projectDir, teamId).lastInsertRowid);
  ensureProjectPages(db, projectId);
  const insertItem = db.prepare(`INSERT INTO backlog_items (project_id, title, request, story, acceptance, tech_notes, points, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')`);
  [
    ["Dust Buddy: airlock dust alarm", "Beep when the airlock has too much dust.", "As a Mars colonist I want an alarm when dust builds up so that my suit seals stay clean.", "- [ ] An alarm threshold is configurable\n- [ ] A note explains how to test it", "## Approach (demo)\nOne small file under demo/ (the scripted agent only writes there).", 3],
    ["Cocoa Printer: marshmallow mode", "Add a marshmallow topping option to the cocoa printer.", "As a homesick astronaut I want marshmallows on my cocoa so that Mars feels a bit more like home.", "- [ ] Marshmallow count 0 to 5\n- [ ] Low gravity setting keeps them on top", "## Approach (demo)\nOne small file under demo/ (the scripted agent only writes there).", 5],
    ["Rover Radio: crater playlists", "Suggest a playlist for each crater the rover passes.", "As a rover driver I want music that fits the crater so that long drives are fun.", "- [ ] Three craters have a playlist\n- [ ] Unknown craters get a default", "## Approach (demo)\nA lookup table under rover-radio/.", 2],
  ].forEach(([title, request, story, acceptance, notes, points], n) => insertItem.run(projectId, title, request, story, acceptance, notes, points, n + 1));
  seedHistory(db, projectId, ids);
  seedDataFactory(db, dataDir, projectId);
  db.prepare("INSERT INTO eval_models (project_id, provider_id, model, for_test, for_judge, note) VALUES (?, ?, ?, 1, 1, ?)")
    .run(projectId, providerId, DEMO_MODEL, "Scripted demo model, no cost.");
  seedDemoRun(db, projectId, providerId);
  return true;
}

/** One finished run of the sample dataset with the demo model. It adds no rows to `runs`, so usage counts stay as they were. */
function seedDemoRun(db: DB, projectId: number, providerId: number) {
  const v = db.prepare(`SELECT v.id FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id
    WHERE d.project_id = ? ORDER BY d.id, v.version DESC LIMIT 1`).get(projectId) as { id: number } | undefined;
  if (!v) return;
  const runId = Number(db.prepare(`INSERT INTO eval_runs (project_id, version_id, name, system_prompt, max_tokens, status, est_low, est_high, cost_usd, created_at, started_at, ended_at)
    VALUES (?, ?, 'Demo run', 'Answer the customer in one or two sentences.', 512, 'done', 0, 0, 0, datetime('now', '-12 minutes'), datetime('now', '-10 minutes'), datetime('now', '-7 minutes'))`)
    .run(projectId, v.id).lastInsertRowid);
  const runModelId = Number(db.prepare("INSERT INTO eval_run_models (run_id, provider_id, provider_name, model) VALUES (?, ?, ?, ?)")
    .run(runId, providerId, DEMO_PROVIDER, DEMO_MODEL).lastInsertRowid);
  const cases = db.prepare("SELECT id, case_key, input, expected FROM eval_cases WHERE version_id = ? ORDER BY position").all(v.id) as
    { id: number; case_key: string; input: string; expected: string | null }[];
  const ins = db.prepare(`INSERT INTO eval_results (run_id, run_model_id, case_id, case_key, answer, status, tokens_in, tokens_out, cost_usd, ms)
    VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, 0, ?)`);
  cases.forEach((c, n) => {
    const answer = demoAnswer(DEMO_MODEL, c.case_key, c.input, c.expected);
    ins.run(runId, runModelId, c.id, c.case_key, answer, Math.ceil(c.input.length / 4), Math.ceil(answer.length / 4), 300 + n * 40);
  });

  // One finished judge run with the scripted demo rule (no `runs` rows, cost 0).
  const judgeId = Number(db.prepare(`INSERT INTO eval_judge_runs (run_id, provider_id, provider_name, model, rubric, max_tokens, status, est_low, est_high, cost_usd, created_at, ended_at)
    VALUES (?, ?, ?, ?, ?, 300, 'done', 0, 0, 0, datetime('now', '-6 minutes'), datetime('now', '-5 minutes'))`)
    .run(runId, providerId, DEMO_PROVIDER, DEMO_MODEL, DEFAULT_RUBRIC).lastInsertRowid);
  const results = db.prepare("SELECT id, case_id, answer FROM eval_results WHERE run_id = ? AND status = 'ok' ORDER BY id").all(runId) as { id: number; case_id: number; answer: string }[];
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const insJudgement = db.prepare(`INSERT INTO eval_judgements (judge_run_id, result_id, score, pass, reason, status, tokens_in, tokens_out, cost_usd, ms)
    VALUES (?, ?, ?, ?, ?, 'ok', 0, 0, 0, ?)`);
  results.forEach((r, n) => {
    const j = JSON.parse(demoJudgeReply(byCase.get(r.case_id)?.expected ?? null, r.answer)) as { score: number; pass: boolean; reason: string };
    insJudgement.run(judgeId, r.id, j.score, j.pass ? 1 : 0, j.reason, 200 + n * 30);
  });
}

/** The Data factory is on in the demo, with one small sample dataset (generic support questions, no real names). */
function seedDataFactory(db: DB, dataDir: string, projectId: number) {
  db.prepare("UPDATE projects SET data_factory = 1 WHERE id = ?").run(projectId);
  const cases = [
    { input: "How do I reset my password?", expected: "Use the 'Forgot password' link on the sign-in page and follow the email.", tags: ["account"] },
    { input: "Where can I see my last invoice?", expected: "Open Billing in your account settings; invoices are listed by date.", tags: ["billing"] },
    { input: "My order has not arrived yet.", expected: "Check the tracking link in your confirmation email; if it has not moved in five days, contact support.", tags: ["shipping"] },
    { input: "Can I change my delivery address after ordering?", expected: "Yes, within one hour of ordering, from Orders; after that the carrier must be contacted.", tags: ["shipping"] },
    { input: "How do I cancel my subscription?", expected: "Go to Settings, then Subscription, and choose Cancel. The plan stays active until the period ends.", tags: ["billing"] },
    { input: "The app crashes when I open the camera.", expected: "Update to the latest version and allow camera access; send the app version to support if it persists.", tags: ["technical"] },
    { input: "Do you offer a refund for a damaged item?", expected: "Yes, photograph the damage and request a refund from Orders within 30 days.", tags: ["returns"] },
    { input: "How do I change the language?", expected: "Open Settings, then Language, and pick one from the list.", tags: ["account"] },
  ];
  const text = cases.map((c) => JSON.stringify(c)).join("\n");
  importDataset(db, dataDir, { projectId, name: "support-questions", format: "jsonl", text, note: "Demo sample" });
}

/** A released first sprint (two merged tasks, runs, release notes) and an active second sprint: one task waiting to run, one needing the user, one merged. */
function seedHistory(db: DB, projectId: number, agentIds: number[]) {
  const [, orbit, comet, sentinel] = agentIds;
  const run = (sql: string, ...args: (string | number | null)[]) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const pi = run("INSERT INTO pis (project_id, name, goal) VALUES (?, 'PI 1: Landing', 'Get the first gadgets onto the Mars base')", projectId);
  const chat = run("INSERT INTO chats (project_id, title) VALUES (?, 'Sprint planning')", projectId);
  const sprint = run(`INSERT INTO sprints (project_id, pi_id, chat_id, number, name, goal, status, branch, capacity, security_verdict, security_report, started_at, finished_at, released_at)
    VALUES (?, ?, ?, 1, 'Touchdown', 'Ship the first two gadgets', 'released', 'sprint/1-touchdown', 16, 'pass', 'No secrets, no network calls, nothing unsafe found (demo).',
      datetime('now', '-6 days'), datetime('now', '-3 days'), datetime('now', '-2 days'))`, projectId, pi, chat);
  const done = [
    ["Airlock door chime", "Chime when the airlock door opens.", "As a colonist I want a chime when the airlock opens so that nobody walks in unnoticed.", 3, orbit, "Added a chime module with three volume levels and a test note.", "Approved in round 1: small, tested, stays inside its folder."],
    ["Dust Buddy: pocket vacuum mode", "A hand-held mode for the dust vacuum.", "As a colonist I want a pocket mode so that I can clean my helmet in the rover.", 5, comet, "Added pocket mode with a 10 minute battery guard. Round 2: fixed the guard so it also stops on low power.", "Approved in round 2 after the battery guard fix."],
  ];
  const lines: string[] = [];
  done.forEach(([title, request, story, points, worker, summary, review], n) => {
    const item = run("INSERT INTO backlog_items (project_id, sprint_id, title, request, story, acceptance, points, priority, status) VALUES (?, ?, ?, ?, ?, '- [x] Works as described', ?, ?, 'done')",
      projectId, sprint, title as string, request as string, story as string, points as number, n + 1);
    const task = run(`INSERT INTO tasks (chat_id, project_id, slug, title, spec, worker_id, reviewer_id, status, round, branch, verdict, summary, review, item_id, sprint_id, cost_usd, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'merged', ?, ?, 'approve', ?, ?, ?, ?, ?, ?)`, chat, projectId, `touchdown-${n + 1}`, title as string, `${request}\n\n${story}`,
      worker as number, sentinel, n, `task/touchdown-${n + 1}`, summary as string, review as string, item, sprint, 0.42 + n * 0.3, 52000 + n * 31000);
    for (const [kind, agent, model] of [["build", worker as number, DEMO_MODEL], ["review", sentinel, DEMO_MODEL]] as const) {
      run(`INSERT INTO runs (task_id, chat_id, project_id, agent_id, kind, round, model, engine, sprint_id, item_id, status, turns, cost_usd, tokens_in, tokens_out, seconds, summary, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, 'done', 6, ?, ?, ?, 90, ?, datetime('now', '-5 days'), datetime('now', '-5 days', '+90 seconds'))`,
        task, chat, projectId, agent, kind, n, model, sprint, item, kind === "build" ? 0.3 + n * 0.2 : 0.12 + n * 0.1, kind === "build" ? 38000 + n * 20000 : 14000 + n * 11000, kind === "build" ? 6000 : 2500, summary as string);
    }
    syncTaskPage(db, task);
    lines.push(`- **${title}**: ${summary}`);
  });
  db.prepare("UPDATE sprints SET release_notes = ? WHERE id = ?").run(`## Sprint 1: Touchdown\n\nThe first two gadgets are on Mars.\n\n${lines.join("\n")}\n`, sprint);
  syncReleasePage(db, sprint);
  const sprint2 = run(`INSERT INTO sprints (project_id, pi_id, chat_id, number, name, goal, status, branch, capacity, started_at)
    VALUES (?, ?, ?, 2, 'Settling in', 'Make the base a little more comfortable', 'active', 'sprint/2-settling-in', 16, datetime('now', '-1 hours'))`, projectId, pi, chat);
  const inSprint = (title: string, status: string, paths: string, worker: number, extra: { summary?: string; review?: string; error?: string; feedback?: string }, taskStatus: string, round: number) => {
    const item = db.prepare("SELECT id, request, story FROM backlog_items WHERE project_id = ? AND title = ?").get(projectId, title) as { id: number; request: string; story: string };
    db.prepare("UPDATE backlog_items SET status = ?, sprint_id = ? WHERE id = ?").run(status, sprint2, item.id);
    const task = run(`INSERT INTO tasks (chat_id, project_id, slug, title, spec, paths, worker_id, reviewer_id, status, round, summary, review, error, feedback, item_id, sprint_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, chat, projectId, title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title,
      `${item.request}\n\n${item.story}`, paths, worker, sentinel, taskStatus, round, extra.summary ?? "", extra.review ?? "", extra.error ?? "", extra.feedback ?? "", item.id, sprint2);
    syncTaskPage(db, task);
  };
  inSprint("Dust Buddy: airlock dust alarm", "in_sprint", '["demo/"]', orbit, {}, "queued", 0);
  inSprint("Cocoa Printer: marshmallow mode", "in_sprint", '["demo/"]', comet, {
    error: "Paused: the server restarted while Comet was working. Press Retry to start again.",
  }, "interrupted", 0);
  db.prepare("INSERT INTO backlog_items (project_id, title, request, story, acceptance, points, priority, status) VALUES (?, 'Greenhouse watering timer', 'A timer that waters the greenhouse.', 'As a colonist I want the greenhouse watered on time so that the tomatoes survive.', '- [x] Waters twice a day', 2, 4, 'ready')").run(projectId);
  inSprint("Greenhouse watering timer", "done", '["greenhouse/"]', orbit, { summary: "Added a watering timer with a twice-a-day schedule.", review: "Approved in round 1." }, "merged", 0);
}
