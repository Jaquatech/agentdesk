import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

// Loaded when the database opens, not at import: node:sqlite prints an "experimental" warning when it loads,
// and by then quiet.ts has filtered it.
const requireBuiltin = createRequire(import.meta.url);
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SEED_PRICES } from "./pricing.ts";

type Statement = {
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
};

/**
 * SQLite through Node's built-in driver (node:sqlite): no native package to compile, so `npm install` works on a
 * clean machine. A thin wrapper keeps the small API the rest of the server uses.
 */
export class DB {
  constructor(private raw: DatabaseSync) {}
  prepare(sql: string): Statement {
    return this.raw.prepare(sql) as unknown as Statement;
  }
  exec(sql: string) {
    this.raw.exec(sql);
  }
  pragma(setting: string) {
    this.raw.exec(`PRAGMA ${setting}`);
  }
  /** Same shape as better-sqlite3: db.transaction(fn)() runs fn in BEGIN … COMMIT, ROLLBACK on error. */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.raw.exec("BEGIN");
      try {
        const out = fn();
        this.raw.exec("COMMIT");
        return out;
      } catch (err) {
        this.raw.exec("ROLLBACK");
        throw err;
      }
    };
  }
  close() {
    this.raw.close();
  }
}


// Each entry runs once, in order. Never edit an applied migration; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE secrets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    ciphertext TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '',
    key_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE providers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','ollama','claude-cli')),
    base_url TEXT NOT NULL DEFAULT '',
    secret_id INTEGER REFERENCES secrets(id) ON DELETE SET NULL,
    default_model TEXT NOT NULL DEFAULT '',
    price_in REAL NOT NULL DEFAULT 0,
    price_out REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE agents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('planner','worker','reviewer')),
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    model TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    max_turns INTEGER NOT NULL DEFAULT 80,
    timeout_min INTEGER NOT NULL DEFAULT 60,
    allowed_tools TEXT NOT NULL DEFAULT '[]',
    appearance TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK (source IN ('local','github','azure')),
    path TEXT NOT NULL,
    repo_url TEXT NOT NULL DEFAULT '',
    base_branch TEXT NOT NULL DEFAULT 'main',
    shell TEXT NOT NULL DEFAULT 'auto',
    setup TEXT NOT NULL DEFAULT '[]',
    verify TEXT NOT NULL DEFAULT '[]',
    allowed_paths TEXT NOT NULL DEFAULT '[]',
    context TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','event')),
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    plan TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    spec TEXT NOT NULL,
    paths TEXT NOT NULL DEFAULT '[]',
    worker_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    reviewer_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    round INTEGER NOT NULL DEFAULT 0,
    branch TEXT NOT NULL DEFAULT '',
    worktree TEXT NOT NULL DEFAULT '',
    commit_sha TEXT NOT NULL DEFAULT '',
    pr_url TEXT NOT NULL DEFAULT '',
    verdict TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    review TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    cost_usd REAL NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    turns INTEGER,
    cost_usd REAL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    seconds INTEGER,
    summary TEXT NOT NULL DEFAULT '',
    log TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE INDEX idx_messages_chat ON messages(chat_id, id);
  CREATE INDEX idx_tasks_chat ON tasks(chat_id, id);
  CREATE INDEX idx_runs_task ON runs(task_id, id);
  `,
  `
  CREATE TABLE model_prices (
    model TEXT PRIMARY KEY,
    price_in REAL NOT NULL,
    price_out REAL NOT NULL,
    cache_read REAL NOT NULL DEFAULT 0,
    cache_write REAL NOT NULL DEFAULT 0,
    long_threshold INTEGER NOT NULL DEFAULT 0,
    long_multiplier REAL NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE runs ADD COLUMN cache_read INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN cache_write INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
  ALTER TABLE runs ADD COLUMN engine TEXT NOT NULL DEFAULT '';
  UPDATE runs SET project_id = (SELECT c.project_id FROM chats c WHERE c.id = runs.chat_id) WHERE project_id IS NULL;
  CREATE INDEX idx_runs_started ON runs(started_at);
  `,
  `
  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_attachments_message ON attachments(message_id);
  `,
  `
  CREATE TABLE project_journal (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_journal_project ON project_journal(project_id, id);
  `,
  `
  ALTER TABLE runs ADD COLUMN transcript TEXT;
  `,
  `
  ALTER TABLE agents ADD COLUMN ask_approval INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE approvals (
    id INTEGER PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'command',
    request TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT NOT NULL DEFAULT '',
    rule TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );
  CREATE INDEX idx_approvals_status ON approvals(status);
  `,
  // Teams: a planner, developers and a reviewer that work together. An agent can be in several teams.
  // A project has a team; a chat can use another one. No team = every enabled agent (as before).
  `
  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    planner_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    reviewer_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE team_members (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, agent_id)
  );
  ALTER TABLE projects ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
  ALTER TABLE chats ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
  -- Existing installs: one team with every agent, led by the planner and reviewer chosen in Settings.
  INSERT INTO teams (name, planner_id, reviewer_id)
    SELECT 'Team',
      (SELECT a.id FROM agents a WHERE a.role = 'planner' AND a.id = (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'default_planner_id')),
      (SELECT a.id FROM agents a WHERE a.role = 'reviewer' AND a.id = (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'default_reviewer_id'))
    WHERE EXISTS (SELECT 1 FROM agents);
  INSERT INTO team_members (team_id, agent_id) SELECT t.id, a.id FROM teams t, agents a;
  UPDATE projects SET team_id = (SELECT id FROM teams ORDER BY id LIMIT 1);
  `,
  // Thinking: '' = the model's default, 'off' = ask the model to answer without a long reasoning phase.
  `
  ALTER TABLE agents ADD COLUMN thinking TEXT NOT NULL DEFAULT '';
  `,
  // The fix instructions of the round being built, so a retry carries on with them instead of starting blind.
  `
  ALTER TABLE tasks ADD COLUMN feedback TEXT NOT NULL DEFAULT '';
  `,
  // Scrum: a project can run as a backlog + sprints (+ PIs that group sprints) instead of free chat.
  // Backlog items are refined (product manager → architect → developer estimate) and become tasks when a sprint starts.
  // A sprint's approved tasks merge into its own branch; Release merges that branch into the base branch.
  `
  ALTER TABLE projects ADD COLUMN process TEXT NOT NULL DEFAULT 'free';
  ALTER TABLE projects ADD COLUMN points_per_dev INTEGER NOT NULL DEFAULT 8;
  ALTER TABLE teams ADD COLUMN architect_id INTEGER REFERENCES agents(id) ON DELETE SET NULL;
  ALTER TABLE teams ADD COLUMN security_id INTEGER REFERENCES agents(id) ON DELETE SET NULL;
  CREATE TABLE pis (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sprints (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pi_id INTEGER REFERENCES pis(id) ON DELETE SET NULL,
    chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','done','released')),
    branch TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 0,
    release_notes TEXT NOT NULL DEFAULT '',
    security_verdict TEXT NOT NULL DEFAULT '',
    security_report TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT,
    released_at TEXT,
    UNIQUE (project_id, number)
  );
  CREATE TABLE backlog_items (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
    chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    request TEXT NOT NULL DEFAULT '',
    story TEXT NOT NULL DEFAULT '',
    acceptance TEXT NOT NULL DEFAULT '',
    tech_notes TEXT NOT NULL DEFAULT '',
    paths TEXT NOT NULL DEFAULT '[]',
    worker TEXT NOT NULL DEFAULT '',
    points INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'refining' CHECK (status IN ('refining','ready','in_sprint','done','dropped','error')),
    step TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_backlog_project ON backlog_items(project_id, status);
  ALTER TABLE tasks ADD COLUMN item_id INTEGER REFERENCES backlog_items(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD COLUMN sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL;
  ALTER TABLE runs ADD COLUMN item_id INTEGER;
  ALTER TABLE runs ADD COLUMN sprint_id INTEGER;
  CREATE INDEX idx_runs_sprint ON runs(sprint_id);
  `,
];

export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const { DatabaseSync: Sqlite } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");
  const db = new DB(new Sqlite(file));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  for (; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
    })();
  }
  // Starter model prices, once (an edited or deleted price is never brought back).
  if (!db.prepare("SELECT value FROM settings WHERE key = 'prices_seeded'").get()) {
    const ins = db.prepare(`INSERT OR IGNORE INTO model_prices (model, price_in, price_out, cache_read, cache_write, long_threshold, long_multiplier, note)
      VALUES (@model, @price_in, @price_out, @cache_read, @cache_write, @long_threshold, @long_multiplier, @note)`);
    db.transaction(() => {
      for (const p of SEED_PRICES) ins.run(p);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('prices_seeded', '1')").run();
    })();
  }
  return db;
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: "My Company",
  office_style: "nordic",
  // office features (Settings > Office) and the company logo
  office_rooms: "true", office_plants: "true", office_coffee: "true", office_sofa: "true",
  office_table: "true", office_arcade: "true", office_slots: "true", office_decor: "true",
  logo_shape: "circle", logo_glyph: "monogram", logo_color: "auto", logo_image: "",
  max_parallel: "3",
  max_review_rounds: "2",
  auto_run_plans: "false",
  push_and_pr: "true",
  budget_day_usd: "0",
  budget_sprint_usd: "0",
};

export function getSettings(db: DB): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export const json = {
  parse<T>(text: string | null | undefined, fallback: T): T {
    if (!text) return fallback;
    try { return JSON.parse(text) as T; } catch { return fallback; }
  },
};
