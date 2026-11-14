import { useCallback, useEffect, useState } from "react";
import { FolderGit2, FolderOpen, Plus, ArrowUp, GitBranch, Sparkles } from "lucide-react";
import { get, post, put, del, parseJson, type Agent, type Project, type Team } from "../api.ts";
import { Field, FooterGap, Modal, ToneBadge } from "../components/ui.tsx";
import { Choice, NoFillInput } from "../components/inputs.tsx";
import { go } from "../App.tsx";
import { Page } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const SOURCES = {
  local: "Local folder",
  github: "GitHub repository",
  azure: "Azure DevOps repository",
};

const join = (v: string) => parseJson<string[]>(v, []).join("\n");

type VerifyHelp = { suggestions: { command: string; label: string }[]; setupSuggestions: { command: string; label: string }[]; envFiles: string[]; warnings: string[] };
const NO_HELP: VerifyHelp = { suggestions: [], setupSuggestions: [], envFiles: [], warnings: [] };

export function ProjectsPage({ openNew, onChanged }: { openNew: boolean; onChanged: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Partial<Project> | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const load = () => { get<Agent[]>("/api/agents").then(setAgents); get<Project[]>("/api/projects").then(setProjects); get<Team[]>("/api/teams").then(setTeams); };
  const blank = (): Partial<Project> => ({ name: "", source: "local", path: "", repo_url: "", base_branch: "main", shell: "auto", setup: "[]", verify: "[]", allowed_paths: "[]", context: "", team_id: null, planner_id: null });
  const [openedFor, setOpenedFor] = useState(false);
  if (openNew !== openedFor) {
    setOpenedFor(openNew);
    if (openNew) setEditing(blank());
  }
  useEffect(() => { load(); }, [openNew]);

  return (
    <Page title="Projects" actions={<Button variant="outline" onClick={() => setEditing(blank())}><Plus data-icon="inline-start" /> New project</Button>}>
      <p className="text-sm text-muted-foreground">
        A project is one git repository. Each task gets its own branch and worktree next to the data folder, so your own checkout is never touched while agents work.
      </p>
      <Card className="gap-0 py-0">
        {projects.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No projects yet.</div>}
        {projects.map((p) => (
          <button key={p.id} type="button" className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted" onClick={() => setEditing(p)}>
            <FolderGit2 className="text-muted-foreground" />
            <div className="min-w-0">
              <b>{p.name}</b> <Badge variant="secondary">{SOURCES[p.source]}</Badge>{" "}
              <ToneBadge tone="accent">{teams.find((t) => t.id === p.team_id)?.name ?? "all agents"}</ToneBadge>
              {p.process === "scrum" && <> <ToneBadge tone="good">Scrum</ToneBadge></>}
              <div className="truncate font-mono text-xs text-muted-foreground">{p.repo_url || p.path} · <GitBranch className="inline" /> {p.base_branch}</div>
            </div>
            <span className="ml-auto text-xs text-muted-foreground">{p.chat_count ?? 0} chats</span>
          </button>
        ))}
      </Card>
      {editing && <ProjectForm p={editing} teams={teams} agents={agents} onClose={() => { setEditing(null); if (openNew) go("projects"); }}
        onSaved={() => { setEditing(null); load(); onChanged(); if (openNew) go("projects"); }} />}
    </Page>
  );
}

function ProjectForm({ p, teams, agents, onClose, onSaved }: { p: Partial<Project>; teams: Team[]; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...p, setup: join(p.setup ?? "[]"), verify: join(p.verify ?? "[]"), allowed_paths: join(p.allowed_paths ?? "[]") });
  const [picker, setPicker] = useState(false);
  const [checkResult, setCheckResult] = useState<{ exists: boolean; git: boolean } | null>(null);
  const check = f.path ? checkResult : null;
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
    if (!f.path) return;
    const t = setTimeout(() => post<{ exists: boolean; git: boolean }>("/api/projects/check-path", { path: f.path }).then(setCheckResult), 300);
    return () => clearTimeout(t);
  }, [f.path]);

  const [helpResult, setHelp] = useState<VerifyHelp>(NO_HELP);
  const help = f.path ? helpResult : NO_HELP;
  useEffect(() => {
    if (!f.path) return;
    const t = setTimeout(() => post<VerifyHelp>("/api/projects/verify-help", { path: f.path, verify: f.verify, setup: f.setup }).then(setHelp).catch(() => {}), 400);
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
      footer={<>{p.id && <Button variant="destructive" onClick={remove}>Remove</Button>}<FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name"><NoFillInput value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Source">
          <Choice value={f.source ?? "local"} onValueChange={(v) => set("source", v)} options={Object.entries(SOURCES).map(([k, v]) => ({ value: k, label: v }))} />
        </Field>
        <Field label="Base branch"><NoFillInput className="font-mono" value={f.base_branch ?? "main"} onChange={(e) => set("base_branch", e.target.value)} /></Field>
      </div>
      <Field label="Team" hint={teams.length ? "Its planner answers this project's chats and hands tasks to its developers. A chat can switch team." : <>No teams yet: every enabled agent works here. <a href="#/teams">Make a team</a>.</>}>
        <Choice value={f.team_id ? String(f.team_id) : ""} onValueChange={(v) => set("team_id", v ? Number(v) : null)}
          options={[{ value: "", label: "No team: every enabled agent" }, ...teams.map((t) => ({ value: String(t.id), label: t.name }))]} />
      </Field>
      <Field label="Planner" hint="Answers this project's chats unless a chat picks another. Automatic = the team's planner.">
        <Choice value={f.planner_id ? String(f.planner_id) : ""} onValueChange={(v) => set("planner_id", v ? Number(v) : null)}
          options={[{ value: "", label: "Automatic (team's planner)" }, ...agents.filter((a) => a.role === "planner" && a.enabled).map((a) => ({ value: String(a.id), label: a.name }))]} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How work is run" hint={f.process === "scrum" ? "A backlog the team refines, sprints by priority and capacity, QA on every task, then a release." : "Chat with the planner; tasks run as soon as you approve them."}>
          <Choice value={f.process ?? "free"} onValueChange={(v) => set("process", v)} options={[{ value: "free", label: "Free chat" }, { value: "scrum", label: "Scrum: backlog, sprints, release" }]} />
        </Field>
        {f.process === "scrum" && (
          <Field label="Points per developer per sprint" hint="Sprint capacity = developers in the team × this.">
            <NoFillInput type="number" min={1} max={60} value={f.points_per_dev ?? 8} onChange={(e) => set("points_per_dev", Number(e.target.value))} />
          </Field>
        )}
      </div>
      {f.source !== "local" && (
        <Field label="Repository URL" hint={f.source === "github" ? "Pull requests are opened with the GitHub CLI (gh) when it is installed and signed in." : "Pull requests are opened with the Azure CLI (az repos) when it is installed and signed in."}>
          <NoFillInput className="font-mono" value={f.repo_url ?? ""} onChange={(e) => set("repo_url", e.target.value)}
            placeholder={f.source === "github" ? "https://github.com/org/repo" : "https://dev.azure.com/org/project/_git/repo"} />
        </Field>
      )}
      <Field label={f.source === "local" ? "Folder (a git repository)" : "Local clone folder (optional; cloned on first use)"}
        hint={check ? (check.git ? "✓ git repository" : check.exists ? (f.source === "local" ? "Not a git repository: run git init there first" : "Not a clone: the repository is cloned into a new subfolder here (named after the repo)") : f.source === "local" ? "Folder not found" : "Will be cloned here") : undefined}>
        <div className="flex items-center gap-2">
          <NoFillInput className="font-mono" value={f.path ?? ""} onChange={(e) => set("path", e.target.value)} placeholder={f.source === "local" ? "C:\\code\\my-repo" : "e.g. C:\\Tools\\my-repo (empty = inside the data folder)"} />
          <Button type="button" variant="outline" onClick={() => setPicker(true)}><FolderOpen data-icon="inline-start" /> Browse</Button>
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Verify commands (one per line; all must pass)" hint="Run in the task's worktree after each build round.">
          <Textarea className="font-mono text-xs" rows={4} value={f.verify} onChange={(e) => set("verify", e.target.value)} placeholder={"npm ci\nnpm test"} />
          {help.warnings.map((w) => <p key={w} className="text-sm text-destructive">⚠ {w}</p>)}
          {help.suggestions.some((x) => !verifyLines.includes(x.command)) && (
            <div className="flex flex-wrap items-center gap-1.5" title="Commands that fit this folder. Click to add one; nothing is added by itself.">
              <span className="text-xs text-muted-foreground">Add:</span>
              {help.suggestions.filter((x) => !verifyLines.includes(x.command)).map((x) => (
                <Button key={x.command} type="button" variant="outline" size="sm" title={x.label} onClick={() => addVerify(x.command)}>+ <span className="font-mono">{x.command}</span></Button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Setup commands (once per new worktree)" hint="E.g. installs. Developers cannot install packages themselves.">
          <Textarea className="font-mono text-xs" rows={4} value={f.setup} onChange={(e) => set("setup", e.target.value)} placeholder="npm ci --no-audit --no-fund" />
          {help.setupSuggestions.some((x) => !setupLines.includes(x.command)) && (
            <div className="flex flex-wrap items-center gap-1.5" title="Install commands that fit this folder. Click to add one; nothing is added by itself.">
              <span className="text-xs text-muted-foreground">Add:</span>
              {help.setupSuggestions.filter((x) => !setupLines.includes(x.command)).map((x) => (
                <Button key={x.command} type="button" variant="outline" size="sm" title={x.label} onClick={() => addSetup(x.command)}>+ <span className="font-mono">{x.command}</span></Button>
              ))}
            </div>
          )}
        </Field>
      </div>
      <Field label="Env file for checks (optional)" hint="A file in the project folder with the settings the verify commands need, such as .env.demo. It is copied into the task's worktree under the name in the copy-as box (default .env) only while they run, then removed (a file already there is restored), and agents never see it. Prefer test values over real secrets: when a check fails, its output goes back to the developer.">
        <div className="flex flex-wrap items-center gap-2">
          <NoFillInput className="max-w-56 font-mono" value={f.checks_env_file ?? ""} onChange={(e) => set("checks_env_file", e.target.value)} placeholder=".env.test" />
          <span className="text-sm text-muted-foreground">copy as</span>
          <NoFillInput className="max-w-40 font-mono" value={f.checks_env_target ?? ""} onChange={(e) => set("checks_env_target", e.target.value)} placeholder=".env" />
        </div>
        {help.envFiles.some((n) => n !== f.checks_env_file) && (
          <div className="flex flex-wrap items-center gap-1.5" title="Env files found in the project folder. Click to use one; it replaces the file name above.">
            <span className="text-xs text-muted-foreground">Use:</span>
            {help.envFiles.filter((n) => n !== f.checks_env_file).map((n) => (
              <Button key={n} type="button" variant="outline" size="sm" onClick={() => set("checks_env_file", n)}><span className="font-mono">{n}</span></Button>
            ))}
          </div>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Always-allowed paths (one per line)" hint="Added to every task's own paths, e.g. a docs file agents keep up to date.">
          <Textarea className="font-mono text-xs" rows={3} value={f.allowed_paths} onChange={(e) => set("allowed_paths", e.target.value)} placeholder="AGENTS.md" />
        </Field>
        <Field label="Shell for commands">
          <Choice value={f.shell ?? "auto"} onValueChange={(v) => set("shell", v)} options={[
            { value: "auto", label: "Automatic (PowerShell on Windows, bash elsewhere)" },
            { value: "powershell", label: "PowerShell" },
            { value: "cmd", label: "cmd.exe" },
            { value: "bash", label: "bash" },
            { value: "sh", label: "sh" },
          ]} />
        </Field>
      </div>
      <Field label="Project notes for every agent" hint={<>Code map, conventions, test commands. <b>Draft with AI</b> lets the planner read the folder and write them (read-only, costs a few cents); edit before saving. An AGENTS.md in the repo works too.</>}>
        <Textarea className="min-h-40 font-mono text-xs" rows={8} value={f.context ?? ""} onChange={(e) => set("context", e.target.value)} placeholder={drafting ? "The planner is reading the repository…" : ""} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={draftNotes} disabled={drafting || !check?.exists}>
          <Sparkles data-icon="inline-start" /> {drafting ? "Reading the code…" : "Draft with AI"}
        </Button>
        {!check?.exists && <span className="text-xs text-muted-foreground">Needs an existing folder (a GitHub/Azure project is cloned on first chat).</span>}
      </div>
      {p.id && <Journal projectId={p.id} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {picker && <FolderPicker start={f.path ?? ""} onPick={(path) => { set("path", path); setPicker(false); }} onClose={() => setPicker(false)} />}
    </Modal>
  );
}

type DirList = { path: string; parent: string | null; git?: boolean; dirs: { name: string; path: string; git: boolean }[] };

function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (p: string) => void; onClose: () => void }) {
  const [list, setList] = useState<DirList | null>(null);
  const open = (path: string) => get<DirList>(`/api/fs/dirs?path=${encodeURIComponent(path)}`).then(setList);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lists the start folder once, when the picker opens
  useEffect(() => { open(start); }, []);
  return (
    <Modal title="Choose a folder" onClose={onClose}
      footer={<><span className="mr-auto truncate font-mono text-xs text-muted-foreground">{list?.path || "Computer"}</span><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!list?.path} onClick={() => onPick(list!.path)}>Use this folder</Button></>}>
      <Card className="max-h-96 gap-0 overflow-auto py-0">
        {list?.parent !== null && list?.path && (
          <button type="button" className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => open(list.parent ?? "")}><ArrowUp /> Up</button>
        )}
        {list?.dirs.map((d) => (
          <button key={d.path} type="button" className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted" onClick={() => open(d.path)}>
            {d.git ? <FolderGit2 className="text-primary-text" /> : <FolderOpen className="text-muted-foreground" />} {d.name}
            {d.git && <ToneBadge tone="accent">git</ToneBadge>}
          </button>
        ))}
        {list && list.dirs.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No subfolders.</div>}
      </Card>
    </Modal>
  );
}

type JournalEntry = { id: number; text: string; created_at: string; chat: string | null; agent: string | null };

/** Notes the planner keeps for later chats of this project. Delete what is wrong or no longer true. */
function Journal({ projectId }: { projectId: number }) {
  const [rows, setRows] = useState<JournalEntry[]>([]);
  const [text, setText] = useState("");
  const load = useCallback(() => get<JournalEntry[]>(`/api/projects/${projectId}/journal`).then(setRows), [projectId]);
  useEffect(() => { load(); }, [load]);
  const add = async () => { if (!text.trim()) return; await post(`/api/projects/${projectId}/journal`, { text }); setText(""); load(); };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2"><b>Project journal</b><span className="text-xs text-muted-foreground">Notes the planner keeps for every later chat ({rows.length}). The newest 40 are read each time.</span></div>
      <Card className="max-h-56 gap-0 overflow-auto py-0">
        {rows.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Empty. The planner adds a note when something should carry over to the next chat.</div>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0">
            <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{r.created_at.slice(0, 10)}</span>
            <span className="flex-1">{r.text}{r.chat && <span className="text-muted-foreground"> · {r.chat}</span>}</span>
            <Button type="button" variant="outline" size="sm" onClick={async () => { await del(`/api/journal/${r.id}`); load(); }}>Delete</Button>
          </div>
        ))}
      </Card>
      <div className="flex items-center gap-2">
        <NoFillInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note yourself, e.g. 'Static site: no npm, preview by opening index.html'"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }} />
        <Button type="button" size="sm" variant="outline" onClick={add}>Add</Button>
      </div>
    </div>
  );
}
