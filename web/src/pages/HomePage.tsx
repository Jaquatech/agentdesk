import { FolderGit2, MessageSquarePlus } from "lucide-react";
import type { Project } from "../api.ts";
import { go } from "../App.tsx";
import { Page } from "../components/page.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function HomePage({ projects, onNewChat }: { projects: Project[]; onNewChat: (id: number) => void }) {
  return (
    <Page title="Start">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">What should the team build?</h2>
        <p className="text-sm text-muted-foreground">Pick a project and start a chat. The planner answers and proposes tasks; developer agents build them in their own branches and the reviewer checks each one before you merge.</p>
      </div>
      {projects.length === 0 ? (
        <Card>
          <CardContent>
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyTitle>Set up the workspace</EmptyTitle>
                <EmptyDescription>Three steps, then the first chat.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-left text-sm">
                  <li>Add a provider and its API key under <a href="#/providers">Providers &amp; keys</a> (Anthropic, OpenAI-compatible, Ollama or the Claude Code CLI).</li>
                  <li>Create a planner, one or more developers and a reviewer under <a href="#/agents">Agents</a>.</li>
                  <li>Add a <a href="#/projects/new">project</a>: a local folder or a GitHub / Azure DevOps repository.</li>
                </ol>
                <Button onClick={() => go("projects/new")}><FolderGit2 data-icon="inline-start" /> Add a project</Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          {projects.map((p) => (
            <button key={p.id} type="button" className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted" onClick={() => onNewChat(p.id)}>
              <FolderGit2 className="text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">{p.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{p.repo_url || p.path}</div>
              </div>
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><MessageSquarePlus /> New chat</span>
            </button>
          ))}
        </Card>
      )}
    </Page>
  );
}
