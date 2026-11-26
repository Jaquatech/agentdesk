import { useCallback, useEffect, useState } from "react";
import { get } from "../../api.ts";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { latestRuns, runName, RUNS_CHANGED } from "./sidebarRuns.ts";

type RunRow = { id: number; name: string; status: string };

/** The newest runs of a project under its Data factory entry in the sidebar, then "View all". */
export function SidebarRuns({ projectId, activeRun }: { projectId: number; activeRun?: number }) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const load = useCallback(() => {
    get<RunRow[]>(`/api/projects/${projectId}/runs`).then(setRows).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    load();
    window.addEventListener("hashchange", load);
    window.addEventListener(RUNS_CHANGED, load);
    return () => { window.removeEventListener("hashchange", load); window.removeEventListener(RUNS_CHANGED, load); };
  }, [load]);

  const { shown, running } = latestRuns(rows);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  if (shown.length === 0) return null;
  return (
    <SidebarMenuSub aria-label="Latest runs">
      {shown.map((r) => (
        <SidebarMenuSubItem key={r.id}>
          <SidebarMenuSubButton asChild size="sm" isActive={activeRun === r.id} title={runName(r)}>
            <a href={`#/data-factory/${projectId}?tab=runs&run=${r.id}`}>
              <span className="truncate">{runName(r)}</span>
              {r.status === "running" && (
                <>
                  <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-full bg-warm" />
                  <span className="sr-only">running</span>
                </>
              )}
            </a>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild size="sm">
          <a href={`#/data-factory/${projectId}?tab=runs`}><span>View all</span></a>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}
