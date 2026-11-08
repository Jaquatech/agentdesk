import { useEffect, useState } from "react";
import { FolderGit2, FolderOpen, Plus, ArrowUp, GitBranch, Sparkles } from "lucide-react";
import { get, post, put, del, parseJson, type Project, type Team } from "../api.ts";
import { Field, Modal } from "../components/ui.tsx";
import { NoFillInput } from "../components/inputs.tsx";
import { go } from "../App.tsx";

const SOURCES = {
  local: "Local folder",
  github: "GitHub repository",
  azure: "Azure DevOps repository",
};

const join = (v: string) => parseJson<string[]>(v, []).join("\n");

export function ProjectsPage({ openNew, onChanged }: { openNew: boolean; onChanged: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Partial<Project> | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const load = () => { get<Project[]>("/api/projects").then(setProjects); get<Team[]>("/api/teams").then(setTeams); };
  const blank = (): Partial<Project> => ({ name: "", source: "local", path: "", repo_url: "", base_branch: "main", shell: "auto", setup: "[]", verify: "[]", allowed_paths: "[]", context: "", team_id: null });
  useEffect(() => { load(); if (openNew) setEditing(blank()); }, [openNew]);

  return (
    <>
      <div className="page-head"><h1>Projects</h1><span className="spacer" /><button className="btn" onClick={() => setEditing(blank())}><Plus size={14} /> New project</button></div>
      <div className="page"><div className="narrow">
        <p className="hint" style={{ marginTop: 0 }}>
          A project is one git repository. Each task gets its own branch and worktree next to the data folder, so your own checkout is never touched while agents work.
        </p>
        <div className="list">
          {projects.length === 0 && <div className="list-row hint">No projects yet.</div>}
          {projects.map((p) => (
            <div key={p.id} className="list-row clickable" onClick={() => setEditing(p)}>
              <FolderGit2 size={16} />
              <div style={{ minWidth: 0 }}>
                <b>{p.name}</b> <span className="badge">{SOURCES[p.source]}</span>
                {" "}<span className="badge accent">{teams.find((t) => t.id === p.team_id)?.name ?? "all agents"}</span>
                {p.process === "scrum" && <>{" "}<span className="badge good">Scrum</span></>}
                <div className="hint mono">{p.repo_url || p.path} · <GitBranch size={11} /> {p.base_branch}</div>
              </div>
              <span className="spacer" />
              <span className="hint">{p.chat_count ?? 0} chats</span>
            </div>
          ))}
        </div>
      </div></div>
      {editing && <ProjectForm p={editing} teams={teams} onClose={() => { setEditing(null); if (openNew) go("projects"); }}
        onSaved={() => { setEditing(null); load(); onChanged(); if (openNew) go("projects"); }} />}
    </>
  );
}

function ProjectForm({ p, teams, onClose, onSaved }: { p: Partial<Project>; teams: Team[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...p, setup: join(p.setup ?? "[]"), verify: join(p.verify ?? "[]"), allowed_paths: join(p.allowed_paths ?? "[]") });
  const [picker, setPicker] = useState(false);
  const [check, setCheck] = useState<{ exists: boolean; git: boolean } | null>(null);
  const [error, setError] = useState("");
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const [drafting, setDrafting] = useState(false);
  const draftNotes = async () => {
    if (f.context?.trim() && !confirm("Replace the current notes with an AI draft?")) return;
    setDrafting(true); setError("");
    try { set("context", (await post<{ notes: string }>("/api/projects/draft-notes", { path: f.path })).notes); }
    catch (e) { setError((e as Error).message); }
    finally { setDrafting(false); }
  };

  useEffect(() => {
    if (!f.path) { setCheck(null); return; }
    const t = setTimeout(() => post("/api/projects/check-path", { path: f.path }).then(setCheck), 300);
    return () => clearTimeout(t);
  }, [f.path]);

  // Verify commands that fit the folder (one click to add) and warnings for ones that cannot work there.
  const [help, setHelp] = useState<{ suggestions: { command: string; label: string }[]; setupSuggestions: { command: string; label: string }[]; envFiles: string[]; warnings: string[] }>({ suggestions: [], setupSuggestions: [], envFiles: [], warnings: [] });
  useEffect(() => {
    if (!f.path) { setHelp({ suggestions: [], setupSuggestions: [], envFiles: [], warnings: [] }); return; }
    const t = setTimeout(() => post<typeof help>("/api/projects/verify-help", { path: f.path, verify: f.verify, setup: f.setup }).then(setHelp).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [f.path, f.verify, f.setup]);
  const verifyLines = String(f.verify ?? "").split("\n").map((l) => l.trim());
  const setupLines = String(f.setup ?? "").split("\n").map((l) => l.trim());
  const append = (key: "verify" | "setup", command: string) => { const cur = String(f[key] ?? ""); set(key, `${cur.replace(/\s+$/, "")}${cur.trim() ? "\n" : ""}${command}`); };
  const addVerify = (command: string) => append("verify", command);
  const addSetup = (command: string) => append("setup", command);

  const save = async () => {
    setError("");
    try {
      if (p.id) await put(`/api/projects/${p.id}`, f); else await post("/api/projects", f);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`Remove project ${p.name} and its chats from AgentDesk? The folder on disk stays.`)) return;
    await del(`/api/projects/${p.id}`);
    onSaved();
  };

  return (
    <Modal title={p.id ? `Edit ${p.name}` : "New project"} onClose={onClose} wide
      footer={<>{p.id && <button className="btn danger" onClick={remove}>Remove</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="grid3">
        <Field label="Name"><NoFillInput value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Source">
          <select value={f.source} onChange={(e) => set("source", e.target.value)}>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Base branch"><NoFillInput className="mono" value={f.base_branch ?? "main"} onChange={(e) => set("base_branch", e.target.value)} /></Field>
      </div>
      <Field label="Team" hint={teams.length ? "Its planner answers this project's chats and hands tasks to its developers. A chat can switch team." : <>No teams yet: every enabled agent works here. <a href="#/teams">Make a team</a>.</>}>
        <select value={f.team_id ?? ""} onChange={(e) => set("team_id", e.target.value ? Number(e.target.value) : null)}>
          <option value="">No team: every enabled agent</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <div className="grid2">
        <Field label="How work is run" hint={f.process === "scrum" ? "A backlog the team refines, sprints by priority and capacity, QA on every task, then a release." : "Chat with the planner; tasks run as soon as you approve them."}>
          <select value={f.process ?? "free"} onChange={(e) => set("process", e.target.value)}>
            <option value="free">Free chat</option>
            <option value="scrum">Scrum: backlog, sprints, release</option>
          </select>
        </Field>
        {f.process === "scrum" && (
          <Field label="Points per developer per sprint" hint="Sprint capacity = developers in the team × this.">
            <NoFillInput type="number" min={1} max={60} value={f.points_per_dev ?? 8} onChange={(e) => set("points_per_dev", Number(e.target.value))} />
          </Field>
        )}
      </div>
      {f.source !== "local" && (
        <Field label="Repository URL" hint={f.source === "github" ? "Pull requests are opened with the GitHub CLI (gh) when it is installed and signed in." : "Pull requests are opened with the Azure CLI (az repos) when it is installed and signed in."}>
          <NoFillInput className="mono" value={f.repo_url ?? ""} onChange={(e) => set("repo_url", e.target.value)}
            placeholder={f.source === "github" ? "https://github.com/org/repo" : "https://dev.azure.com/org/project/_git/repo"} />
        </Field>
      )}
      <Field label={f.source === "local" ? "Folder (a git repository)" : "Local clone folder (optional; cloned on first use)"}
        hint={check ? (check.git ? "✓ git repository" : check.exists ? (f.source === "local" ? "Not a git repository: run git init there first" : "Not a clone: the repository is cloned into a new subfolder here (named after the repo)") : f.source === "local" ? "Folder not found" : "Will be cloned here") : undefined}>
        <div className="row" style={{ gap: 6 }}>
          <NoFillInput className="mono" value={f.path ?? ""} onChange={(e) => set("path", e.target.value)} placeholder={f.source === "local" ? "C:\\code\\my-repo" : "e.g. C:\\Tools\\my-repo (empty = inside the data folder)"} />
          <button className="btn" type="button" onClick={() => setPicker(true)}><FolderOpen size={14} /> Browse</button>
        </div>
      </Field>
      <div className="grid2">
        <Field label="Verify commands (one per line; all must pass)" hint="Run in the task's worktree after each build round.">
          <textarea className="mono" rows={4} value={f.verify} onChange={(e) => set("verify", e.target.value)} placeholder={"npm ci\nnpm test"} />
          {help.warnings.map((w) => <div key={w} className="error" style={{ marginTop: 4 }}>⚠ {w}</div>)}
          {help.suggestions.some((x) => !verifyLines.includes(x.command)) && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }} title="Commands that fit this folder. Click to add one; nothing is added by itself.">
              <span className="hint">Add:</span>
              {help.suggestions.filter((x) => !verifyLines.includes(x.command)).map((x) => (
                <button key={x.command} type="button" className="btn" title={x.label} onClick={() => addVerify(x.command)}>+ <span className="mono">{x.command}</span></button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Setup commands (once per new worktree)" hint="E.g. installs. Developers cannot install packages themselves.">
          <textarea className="mono" rows={4} value={f.setup} onChange={(e) => set("setup", e.target.value)} placeholder="npm ci --no-audit --no-fund" />
          {help.setupSuggestions.some((x) => !setupLines.includes(x.command)) && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }} title="Install commands that fit this folder. Click to add one; nothing is added by itself.">
              <span className="hint">Add:</span>
              {help.setupSuggestions.filter((x) => !setupLines.includes(x.command)).map((x) => (
                <button key={x.command} type="button" className="btn" title={x.label} onClick={() => addSetup(x.command)}>+ <span className="mono">{x.command}</span></button>
              ))}
            </div>
          )}
        </Field>
      </div>
      <Field label="Env file for checks (optional)" hint="A file in the project folder with the settings the verify commands need, such as .env.demo. It is copied into the task's worktree under the name below only while they run, then removed (a file already there is restored), and agents never see it. Prefer test values over real secrets: when a check fails, its output goes back to the developer.">
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <NoFillInput className="mono" style={{ maxWidth: 220 }} value={f.checks_env_file ?? ""} onChange={(e) => set("checks_env_file", e.target.value)} placeholder=".env.test" />
          <span className="muted">copy as</span>
          <NoFillInput className="mono" style={{ maxWidth: 160 }} value={f.checks_env_target ?? ""} onChange={(e) => set("checks_env_target", e.target.value)} placeholder=".env" />
          {help.envFiles.filter((n) => n !== f.checks_env_file).map((n) => (
            <button key={n} type="button" className="btn" title={`Use ${n} from the project folder`} onClick={() => set("checks_env_file", n)}>Use <span className="mono">{n}</span></button>
          ))}
        </div>
      </Field>
      <div className="grid2">
        <Field label="Always-allowed paths (one per line)" hint="Added to every task's own paths, e.g. a docs file agents keep up to date.">
          <textarea className="mono" rows={3} value={f.allowed_paths} onChange={(e) => set("allowed_paths", e.target.value)} placeholder="AGENTS.md" />
        </Field>
        <Field label="Shell for commands">
          <select value={f.shell ?? "auto"} onChange={(e) => set("shell", e.target.value)}>
            <option value="auto">Automatic (PowerShell on Windows, bash elsewhere)</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">cmd.exe</option>
            <option value="bash">bash</option>
            <option value="sh">sh</option>
          </select>
        </Field>
      </div>
      <Field label="Project notes for every agent" hint={<>Code map, conventions, test commands. <b>Draft with AI</b> lets the planner read the folder and write them (read-only, costs a few cents); edit before saving. An AGENTS.md in the repo works too.</>}>
        <textarea className="mono" rows={8} value={f.context ?? ""} onChange={(e) => set("context", e.target.value)} placeholder={drafting ? "The planner is reading the repository…" : ""} />
      </Field>
      <div className="row" style={{ marginTop: -6, marginBottom: 12 }}>
        <button type="button" className="btn small" onClick={draftNotes} disabled={drafting || !check?.exists}>
          <Sparkles size={13} /> {drafting ? "Reading the code…" : "Draft with AI"}
        </button>
        {!check?.exists && <span className="hint">Needs an existing folder (a GitHub/Azure project is cloned on first chat).</span>}
      </div>
      {p.id && <Journal projectId={p.id} />}
      {error && <div className="error">{error}</div>}
      {picker && <FolderPicker start={f.path ?? ""} onPick={(path) => { set("path", path); setPicker(false); }} onClose={() => setPicker(false)} />}
    </Modal>
  );
}

type DirList = { path: string; parent: string | null; git?: boolean; dirs: { name: string; path: string; git: boolean }[] };

function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (p: string) => void; onClose: () => void }) {
  const [list, setList] = useState<DirList | null>(null);
  const open = (path: string) => get<DirList>(`/api/fs/dirs?path=${encodeURIComponent(path)}`).then(setList);
  useEffect(() => { open(start); }, []);
  return (
    <Modal title="Choose a folder" onClose={onClose}
      footer={<><span className="hint mono" style={{ marginRight: "auto" }}>{list?.path || "Computer"}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!list?.path} onClick={() => onPick(list!.path)}>Use this folder</button></>}>
      <div className="list" style={{ maxHeight: 380, overflow: "auto" }}>
        {list?.parent !== null && list?.path && (
          <div className="list-row clickable" onClick={() => open(list.parent ?? "")}><ArrowUp size={14} /> Up</div>
        )}
        {list?.dirs.map((d) => (
          <div key={d.path} className="list-row clickable" onClick={() => open(d.path)}>
            {d.git ? <FolderGit2 size={14} color="var(--accent)" /> : <FolderOpen size={14} />} {d.name}
            {d.git && <span className="badge accent">git</span>}
          </div>
        ))}
        {list && list.dirs.length === 0 && <div className="list-row hint">No subfolders.</div>}
      </div>
    </Modal>
  );
}

type JournalEntry = { id: number; text: string; created_at: string; chat: string | null; agent: string | null };

/** Notes the planner keeps for later chats of this project. Delete what is wrong or no longer true. */
function Journal({ projectId }: { projectId: number }) {
  const [rows, setRows] = useState<JournalEntry[]>([]);
  const [text, setText] = useState("");
  const load = () => get<JournalEntry[]>(`/api/projects/${projectId}/journal`).then(setRows);
  useEffect(() => { load(); }, [projectId]);
  const add = async () => { if (!text.trim()) return; await post(`/api/projects/${projectId}/journal`, { text }); setText(""); load(); };
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row"><b>Project journal</b><span className="hint">Notes the planner keeps for every later chat ({rows.length}). The newest 40 are read each time.</span></div>
      <div className="list" style={{ marginTop: 6, maxHeight: 220, overflow: "auto" }}>
        {rows.length === 0 && <div className="list-row hint">Empty. The planner adds a note when something should carry over to the next chat.</div>}
        {rows.map((r) => (
          <div key={r.id} className="list-row" style={{ alignItems: "flex-start", fontSize: 13 }}>
            <span className="hint mono" style={{ whiteSpace: "nowrap" }}>{r.created_at.slice(0, 10)}</span>
            <span style={{ flex: 1 }}>{r.text}{r.chat && <span className="hint"> · {r.chat}</span>}</span>
            <button type="button" className="btn small" onClick={async () => { await del(`/api/journal/${r.id}`); load(); }}>Delete</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6, gap: 6 }}>
        <NoFillInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note yourself, e.g. 'Static site: no npm, preview by opening index.html'"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn small" onClick={add}>Add</button>
      </div>
    </div>
  );
}
