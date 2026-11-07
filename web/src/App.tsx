import { useCallback, useEffect, useState } from "react";
import { BarChart3, BookOpen, Bot, Kanban, Users, Building2, FolderGit2, KeyRound, ListChecks, LogOut, MessageSquarePlus, Plus, Settings, ChevronDown, ChevronRight } from "lucide-react";
import { get, post, closeLiveEvents, useLiveEvents, type Chat, type Project } from "./api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { TeamsPage } from "./pages/TeamsPage.tsx";
import { GuidesPage } from "./pages/GuidesPage.tsx";
import { ProvidersPage } from "./pages/ProvidersPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { TasksBoard } from "./pages/TasksBoard.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { UsagePage } from "./pages/UsagePage.tsx";
import { ScrumPage } from "./pages/ScrumPage.tsx";
import { ApprovalsBar } from "./components/Approvals.tsx";
import { BudgetBar } from "./components/BudgetBar.tsx";
import { Office } from "./office/Office.tsx";

export type Route = { page: string; id?: number; tab?: string };

function parseHash(): Route {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [page, id] = path.split("/");
  const tab = new URLSearchParams(query ?? "").get("tab") ?? undefined;
  return { page: page || "home", id: id ? Number(id) : undefined, tab };
}

export function go(route: string) {
  location.hash = `#/${route}`;
}

export function App() {
  const [auth, setAuth] = useState<{ needsSetup: boolean; demo?: boolean; user: { username: string } | null } | null>(null);
  const [route, setRoute] = useState<Route>(parseHash());

  const loadAuth = useCallback(() => { get("/api/auth/status").then(setAuth); }, []);
  useEffect(() => {
    loadAuth();
    const onHash = () => setRoute(parseHash());
    const onOut = () => { closeLiveEvents(); loadAuth(); };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("agentdesk:signed-out", onOut);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("agentdesk:signed-out", onOut); };
  }, [loadAuth]);

  if (!auth) return null;
  if (!auth.user) return <LoginPage setup={auth.needsSetup} onDone={loadAuth} />;
  return <Shell route={route} demo={!!auth.demo} username={auth.user.username} onSignOut={async () => { await post("/api/auth/logout"); closeLiveEvents(); loadAuth(); }} />;
}

function Shell({ route, username, demo, onSignOut }: { route: Route; username: string; demo: boolean; onSignOut: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [company, setCompany] = useState("");

  const reload = useCallback(() => {
    get<Project[]>("/api/projects").then(setProjects);
    get<Chat[]>("/api/chats").then(setChats);
    get<Record<string, string>>("/api/settings").then((s) => setCompany(s.company_name));
  }, []);
  useEffect(() => { reload(); }, [reload, route.page]);
  useLiveEvents((ev) => { if (ev.type === "message" || ev.type === "task") get<Chat[]>("/api/chats").then(setChats); });

  const newChat = async (projectId: number) => {
    const chat = await post<Chat>("/api/chats", { project_id: projectId });
    await reload();
    go(`chat/${chat.id}`);
  };

  const nav = (page: string, label: string, Icon: typeof Bot) => (
    <a className={`side-item ${route.page === page ? "active" : ""}`} href={`#/${page}`}>
      <Icon size={15} /> <span className="ellipsis">{label}</span>
    </a>
  );

  const activeChat = route.page === "chat" ? chats.find((c) => c.id === route.id) : undefined;

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-head">
          <Building2 size={20} color="#e8b04b" />
          <div className="brand">AgentDesk<small>{company}</small></div>
        </div>
        <div className="side-scroll">
          {nav("tasks", "Running tasks", ListChecks)}
          {nav("office", "Office", Building2)}
          <div className="side-section">
            Projects
            <button className="icon-btn" title="New project" onClick={() => go("projects/new")}><Plus size={14} /></button>
          </div>
          {projects.length === 0 && <div className="hint" style={{ padding: "4px 8px", color: "#8b938c" }}>Add a project to start chatting.</div>}
          {projects.map((p) => {
            const open = !collapsed.has(p.id);
            const pchats = chats.filter((c) => c.project_id === p.id);
            return (
              <div key={p.id}>
                <div className="row" style={{ gap: 0 }}>
                  <button className="side-item" onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="ellipsis">{p.name}</span>
                  </button>
                  <button className="icon-btn" title="New chat" onClick={() => newChat(p.id)}><MessageSquarePlus size={14} /></button>
                </div>
                {open && p.process === "scrum" && (
                  <a className={`side-item side-chat ${route.page === "scrum" && route.id === p.id ? "active" : ""}`} href={`#/scrum/${p.id}`}>
                    <Kanban size={13} /> <span className="ellipsis">Backlog & sprints</span>
                  </a>
                )}
                {open && pchats.map((c) => (
                  <a key={c.id} className={`side-item side-chat ${activeChat?.id === c.id ? "active" : ""}`} href={`#/chat/${c.id}`} title={c.title}>
                    <span className="ellipsis">{c.title}</span>
                    {!!c.active_tasks && <span className="count"><span className="dot" /></span>}
                  </a>
                ))}
              </div>
            );
          })}
          <div className="side-section">Team</div>
          {nav("teams", "Teams", Users)}
          {nav("agents", "Agents", Bot)}
          {nav("providers", "Providers & keys", KeyRound)}
          {nav("guides", "Guides", BookOpen)}
          {nav("usage", "Usage & billing", BarChart3)}
          {nav("projects", "Projects", FolderGit2)}
          {nav("settings", "Settings", Settings)}
        </div>
        <div className="side-foot row">
          <span className="hint" style={{ color: "#8b938c", paddingLeft: 8 }}>{username}</span>
          <span className="spacer" />
          <button className="icon-btn" title="Sign out" onClick={onSignOut}><LogOut size={15} /></button>
        </div>
      </aside>
      <main className="main">
        <ApprovalsBar />
        <BudgetBar />
        {demo && (
          <div className="demo-banner">
            <b>Demo mode</b> Scripted agents: no model calls, no real code changes, nothing is pushed. Start with <code>npm start</code> for real work.
          </div>
        )}
        {route.page === "chat" && route.id ? <ChatPage key={route.id} chatId={route.id} tab={route.tab} projects={projects} onChanged={reload} />
          : route.page === "scrum" && route.id ? <ScrumPage key={route.id} projectId={route.id} />
          : route.page === "tasks" ? <TasksBoard />
          : route.page === "office" ? <><div className="page-head"><h1>Office</h1></div><div style={{ flex: 1, minHeight: 0 }}><Office /></div></>
          : route.page === "teams" ? <TeamsPage />
          : route.page === "guides" || route.page === "models" ? <GuidesPage tab={route.page === "models" ? "models" : route.tab} />
          : route.page === "agents" ? <AgentsPage />
          : route.page === "providers" ? <ProvidersPage />
          : route.page === "projects" ? <ProjectsPage openNew={route.id === undefined && location.hash.includes("new")} onChanged={reload} />
          : route.page === "usage" ? <UsagePage />
          : route.page === "settings" ? <SettingsPage onChanged={reload} />
          : <HomePage projects={projects} onNewChat={newChat} />}
      </main>
    </div>
  );
}
