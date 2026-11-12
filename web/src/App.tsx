import { useCallback, useEffect, useState } from "react";
import { BarChart3, BookOpen, Bot, Kanban, Users, Building2, FolderGit2, KeyRound, ListChecks, LogOut, MessageSquarePlus, Plus, Settings, ChevronDown, Info } from "lucide-react";
import { get, post, closeLiveEvents, useLiveEvents, type Chat, type Project } from "./api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { TeamsPage } from "./pages/TeamsPage.tsx";
import { DocumentsPage } from "./pages/DocumentsPage.tsx";
import { ProvidersPage } from "./pages/ProvidersPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { TasksBoard } from "./pages/TasksBoard.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { UsagePage } from "./pages/UsagePage.tsx";
import { ScrumPage } from "./pages/ScrumPage.tsx";
import { VersionPage } from "./pages/VersionPage.tsx";
import { ApprovalsBar } from "./components/Approvals.tsx";
import { BudgetBar } from "./components/BudgetBar.tsx";
import { ThemeToggle } from "./components/theme.tsx";
import { Office } from "./office/Office.tsx";
import { LogoMark } from "./office/LogoMark.tsx";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from "@/components/ui/sidebar";

export type Route = { page: string; id?: number; tab?: string; sprint?: number; task?: number; group?: string };

function parseHash(): Route {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [page, rawId] = path.split("/");
  const q = new URLSearchParams(query ?? "");
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
  const idNum = rawId ? Number(rawId) : NaN;
  // "projects/new" is not an id; only numeric path segments are.
  return { page: page || "home", id: Number.isFinite(idNum) ? idNum : undefined, tab: q.get("tab") ?? undefined, sprint: num("sprint"), task: num("task"), group: q.get("group") ?? undefined };
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
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [ver, setVer] = useState<{ version: string; commit: string } | null>(null);
  useEffect(() => { get<{ version: string; commit: string }>("/api/version").then(setVer).catch(() => {}); }, []);

  const reload = useCallback(() => {
    get<Project[]>("/api/projects").then(setProjects);
    get<Chat[]>("/api/chats").then(setChats);
    get<Record<string, string>>("/api/settings").then(setSettings);
  }, []);
  useEffect(() => { reload(); }, [reload, route.page]);
  useLiveEvents((ev) => { if (ev.type === "message" || ev.type === "task") get<Chat[]>("/api/chats").then(setChats); });

  const newChat = async (projectId: number) => {
    const chat = await post<Chat>("/api/chats", { project_id: projectId });
    await reload();
    go(`chat/${chat.id}`);
  };

  const nav = (page: string, label: string, Icon: typeof Bot) => (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={route.page === page} tooltip={label}>
        <a href={`#/${page}`}><Icon /> <span>{label}</span></a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const activeChat = route.page === "chat" ? chats.find((c) => c.id === route.id) : undefined;

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1">
            <LogoMark settings={settings} size={28} />
            <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold">AgentDesk</div>
              {settings.company_name && <div className="truncate text-xs text-muted-foreground">{settings.company_name}</div>}
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav("tasks", "Running tasks", ListChecks)}
                {nav("office", "Office", Building2)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction title="New project" onClick={() => go("projects/new")}>
              <Plus /> <span className="sr-only">New project</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              {projects.length === 0 && <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Add a project to start chatting.</p>}
              <SidebarMenu>
                {projects.map((p) => {
                  const open = !collapsed.has(p.id);
                  const pchats = chats.filter((c) => c.project_id === p.id);
                  return (
                    <Collapsible key={p.id} open={open} onOpenChange={(next) => setCollapsed((s) => { const n = new Set(s); if (next) n.delete(p.id); else n.add(p.id); return n; })}>
                      <SidebarMenuItem>
                        <div className="flex items-center">
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton className="min-w-0 flex-1" tooltip={p.name}>
                              <ChevronDown className={`transition-transform ${open ? "" : "-rotate-90"}`} />
                              <span className="truncate">{p.name}</span>
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <Button variant="ghost" size="icon-sm" className="shrink-0 group-data-[collapsible=icon]:hidden" title="New chat" onClick={() => newChat(p.id)}>
                            <MessageSquarePlus />
                            <span className="sr-only">New chat</span>
                          </Button>
                        </div>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {p.process === "scrum" && (
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton asChild isActive={route.page === "scrum" && route.id === p.id}>
                                  <a href={`#/scrum/${p.id}`}><Kanban /> <span>Backlog & PIs</span></a>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )}
                            {pchats.map((c) => (
                              <SidebarMenuSubItem key={c.id}>
                                <SidebarMenuSubButton asChild isActive={activeChat?.id === c.id} title={c.title}>
                                  <a href={`#/chat/${c.id}`}>
                                    <span className="truncate">{c.title}</span>
                                    {!!c.active_tasks && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warm" />}
                                  </a>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Team</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav("teams", "Teams", Users)}
                {nav("agents", "Agents", Bot)}
                {nav("providers", "Providers & keys", KeyRound)}
                {nav("documents", "Documents", BookOpen)}
                {nav("usage", "Usage & billing", BarChart3)}
                {nav("projects", "Projects", FolderGit2)}
                {nav("settings", "Settings", Settings)}
                {nav("version", "Version", Info)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-1 px-1">
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-xs text-muted-foreground">{username}</div>
              {ver?.version && (
                <a className="block truncate text-[11px] text-muted-foreground no-underline hover:text-foreground" href="#/version" title={ver.commit ? `Version ${ver.version}, commit ${ver.commit}` : `Version ${ver.version}`}>
                  v{ver.version}{ver.commit ? ` · ${ver.commit}` : ""}
                </a>
              )}
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="icon-sm" title="Sign out" onClick={onSignOut}>
              <LogOut />
              <span className="sr-only">Sign out</span>
            </Button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
        <div className="flex h-full min-h-0 flex-col">
          <ApprovalsBar />
          <BudgetBar />
          {demo && (
            <div className="flex shrink-0 items-center gap-2 border-b bg-warning/15 px-4 py-1.5 text-xs text-foreground">
              <b>Demo mode</b>
              <span>Scripted agents: no model calls, no real code changes, nothing is pushed. Start with <code className="font-mono">npm start</code> for real work.</span>
            </div>
          )}
          {route.page === "chat" && route.id ? <ChatPage key={route.id} chatId={route.id} tab={route.tab} projects={projects} onChanged={reload} />
            : route.page === "scrum" && route.id ? <ScrumPage key={`${route.id}-${route.tab}-${route.sprint}-${route.task}`} projectId={route.id} initial={{ tab: route.tab, sprint: route.sprint, task: route.task }} />
            : route.page === "tasks" ? <TasksBoard key={`${route.group}-${route.task}`} group={route.group} task={route.task} />
            : route.page === "office" ? <OfficePage />
            : route.page === "teams" ? <TeamsPage />
            : route.page === "documents" ? <DocumentsPage key={`${route.id ?? ""}-${route.tab ?? ""}`} id={route.id} builtin={route.tab} />
            : route.page === "guides" || route.page === "models" ? <DocumentsPage builtin={route.page === "models" || route.tab === "models" ? "models" : "cycle"} />
            : route.page === "agents" ? <AgentsPage />
            : route.page === "providers" ? <ProvidersPage />
            : route.page === "projects" ? <ProjectsPage openNew={route.id === undefined && location.hash.includes("new")} onChanged={reload} />
            : route.page === "usage" ? <UsagePage />
            : route.page === "settings" ? <SettingsPage onChanged={reload} />
            : route.page === "version" ? <VersionPage />
            : <HomePage projects={projects} onNewChat={newChat} />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function OfficePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
        <SidebarTrigger />
        <h1 className="text-sm font-medium">Office</h1>
      </header>
      <div className="min-h-0 flex-1"><Office /></div>
    </div>
  );
}
