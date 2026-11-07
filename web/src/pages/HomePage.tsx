import { FolderGit2, MessageSquarePlus } from "lucide-react";
import type { Project } from "../api.ts";
import { go } from "../App.tsx";

export function HomePage({ projects, onNewChat }: { projects: Project[]; onNewChat: (id: number) => void }) {
  return (
    <>
      <div className="page-head"><h1>Start</h1></div>
      <div className="page"><div className="narrow">
        <h2 style={{ marginTop: 0 }}>What should the team build?</h2>
        <p className="hint">Pick a project and start a chat. The planner answers and proposes tasks; developer agents build them in their own branches and the reviewer checks each one before you merge.</p>
        {projects.length === 0 ? (
          <div className="card card-pad">
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              <li>Add a provider and its API key under <a href="#/providers">Providers &amp; keys</a> (Anthropic, OpenAI-compatible, Ollama or the Claude Code CLI).</li>
              <li>Create a planner, one or more developers and a reviewer under <a href="#/agents">Agents</a>.</li>
              <li>Add a <a href="#/projects/new">project</a>: a local folder or a GitHub / Azure DevOps repository.</li>
            </ol>
            <button className="btn primary" style={{ marginTop: 14 }} onClick={() => go("projects/new")}><FolderGit2 size={15} /> Add a project</button>
          </div>
        ) : (
          <div className="list">
            {projects.map((p) => (
              <div key={p.id} className="list-row clickable" onClick={() => onNewChat(p.id)}>
                <FolderGit2 size={16} />
                <div><b>{p.name}</b><div className="hint mono">{p.repo_url || p.path}</div></div>
                <span className="spacer" />
                <span className="btn small"><MessageSquarePlus size={14} /> New chat</span>
              </div>
            ))}
          </div>
        )}
      </div></div>
    </>
  );
}
