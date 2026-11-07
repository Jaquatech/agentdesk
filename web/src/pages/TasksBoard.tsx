import { useEffect, useState } from "react";
import { get, type Agent } from "../api.ts";
import { TaskPanel } from "./TaskPanel.tsx";

export function TasksBoard({ group, task }: { group?: string; task?: number }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => { get<Agent[]>("/api/agents").then(setAgents); }, []);
  return (
    <>
      <div className="page-head"><h1>Running tasks</h1><span className="hint">All projects</span></div>
      <div style={{ flex: 1, minHeight: 0 }}><TaskPanel agents={agents} initialGroup={group} initialTask={task} /></div>
    </>
  );
}
