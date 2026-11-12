import { useEffect, useState } from "react";
import { get, type Agent } from "../api.ts";
import { Page } from "../components/page.tsx";
import { TaskPanel } from "./TaskPanel.tsx";

export function TasksBoard({ group, task }: { group?: string; task?: number }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => { get<Agent[]>("/api/agents").then(setAgents); }, []);
  return (
    <Page title={<><span>Running tasks</span><span className="font-normal text-muted-foreground">All projects</span></>} bleed>
      <TaskPanel agents={agents} initialGroup={group} initialTask={task} />
    </Page>
  );
}
