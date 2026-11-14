import { useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";
import { get, put, useLoad, useLiveEvents, type Agent } from "../api.ts";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Overview, type Sel, type Tab, TABS, groupsByTab } from "./scrum/model.ts";
import { BacklogView } from "./scrum/Backlog.tsx";
import { NameModal, PiView } from "./scrum/Sprints.tsx";

export function ScrumPage({ projectId, initial }: { projectId: number; initial?: { tab?: string; sprint?: number; task?: number } }) {
  const { data, reload } = useLoad<Overview>(`/api/projects/${projectId}/scrum`);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<Tab | null>(TABS.some((t) => t.id === initial?.tab) ? (initial!.tab as Tab) : null);
  const [sel, setSel] = useState<Sel | null>(initial?.task ? { k: "task", id: initial.task } : initial?.sprint ? { k: "sprint", id: initial.sprint } : null);
  const [modal, setModal] = useState<{ kind: "pi" | "sprint"; pi?: number } | null>(null);
  useEffect(() => { get<Agent[]>("/api/agents").then(setAgents); }, []);
  useLiveEvents((ev) => { if ((ev.type === "scrum" && ev.projectId === projectId) || ev.type === "task") reload(); });

  const groups = useMemo(() => (data ? groupsByTab(data) : { coming: [], current: [], releases: [] }), [data]);
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (data.project.process !== "scrum") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-3"><SidebarTrigger /><h1 className="text-sm font-medium">Backlog & PIs</h1></header>
        <div className="p-6"><Card><CardContent>{data.project.name} runs as free chat. Change <b>How work is run</b> to Scrum under <a href="#/projects">Projects</a>.</CardContent></Card></div>
      </div>
    );
  }

  const open = data.items.filter((i) => !["done", "dropped"].includes(i.status));
  const shown: Tab = tab ?? (groups.current.length ? "current" : "backlog");
  const count: Record<Tab, number> = {
    backlog: open.length, coming: groups.coming.length, current: groups.current.reduce((n, g) => n + g.sprints.length, 0),
    releases: data.sprints.filter((s) => s.status === "released").length,
  };
  const pick = (t: Tab) => { setTab(t); setSel(null); };
  const savePoints = async (n: number) => { await put(`/api/projects/${projectId}/scrum/settings`, { points_per_dev: n }); reload(); };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <SidebarTrigger />
        <span className="text-sm text-muted-foreground">{data.project.name}</span>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-sm font-medium">Backlog & PIs</h1>
        <Tabs value={shown} onValueChange={(v) => pick(v as Tab)} className="ml-auto w-auto">
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.id} value={t.id} title={t.hint}>{t.label} · {count[t.id]}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </header>
      <div className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2 text-sm text-primary-text">
        <Flag />
        <div className="min-w-0 flex-1"><b className="font-medium text-foreground">{data.cycle.text}</b></div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Sprint capacity = developers in the team × points per developer">
          Capacity {data.capacity.capacity} pts = {data.capacity.developers} dev ×
          <Input className="h-7 w-14" type="number" min={1} max={60} defaultValue={data.capacity.points_per_dev}
            onBlur={(e) => { const n = Number(e.target.value); if (n && n !== data.capacity.points_per_dev) savePoints(n); }} />
        </label>
      </div>
      <div className="min-h-0 flex-1">
        {shown === "backlog"
          ? <BacklogView data={data} sel={sel} setSel={setSel} reload={reload} />
          : <PiView key={shown} tab={shown} groups={groups[shown]} data={data} agents={agents} sel={sel} setSel={setSel} reload={reload}
              onNew={(kind, pi) => setModal({ kind, pi })} />}
      </div>
      {modal && <NameModal kind={modal.kind} projectId={projectId} pis={data.pis.filter((p) => p.status === "active")} pi={modal.pi}
        onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); if (modal.kind === "pi") pick("coming"); }} />}
    </div>
  );
}
