import { useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useLiveEvents, useLoad, type Project } from "../api.ts";
import { go } from "../App.tsx";
import { Page } from "../components/page.tsx";
import { DocRow } from "../components/documents/DocRow.tsx";
import { DocView } from "../components/documents/DocView.tsx";
import { NewDocument } from "../components/documents/NewDocument.tsx";
import { openWikiPage, projectPages, wikiGroups, type Doc, type DocList } from "../components/documents/model.ts";
import { Button } from "@/components/ui/button";

/** The wiki of one project: its sections as a list on the left, the open page on the right. */
export function ProjectWikiPage({ projectId, doc: docId }: { projectId: number; doc?: number }) {
  const { data: projects } = useLoad<Project[]>("/api/projects");
  const { data: docs, reload } = useLoad<DocList[]>("/api/documents");
  const [creating, setCreating] = useState(false);
  const open = openWikiPage(docs, projectId, docId);
  const selected = open?.id;
  const { data: doc, reload: reloadDoc } = useLoad<Doc>(selected ? `/api/documents/${selected}` : null);
  useLiveEvents((ev) => { if (ev.type === "task" && doc?.task_id === ev.task.id) reloadDoc(); });
  const pageScroll = useRef<HTMLDivElement>(null);
  const shown = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (shown.current === selected) return;
    shown.current = selected;
    if (pageScroll.current) pageScroll.current.scrollTop = 0;
  }, [selected]);

  if (!projects) return null;
  const project = projects.find((p) => p.id === projectId);
  if (!project) return <Page title="Project wiki"><p className="text-sm text-muted-foreground">No such project.</p></Page>;
  if (project.project_wiki === 0) {
    return <Page title={project.name}><p className="text-sm text-muted-foreground">The Project wiki is off for this project. Turn it on under <a href="#/projects">Projects</a>.</p></Page>;
  }

  const { sections, other } = wikiGroups(projectPages(docs, projectId));
  const openRow = (d: DocList) => <DocRow key={d.id} doc={d} active={d.id === selected} nested onOpen={() => go(`wiki/${projectId}?doc=${d.id}`)} />;

  return (
    <Page
      title={<><span className="text-muted-foreground">{project.name}</span><span className="text-muted-foreground">/</span><h1 className="text-sm font-medium">Project wiki</h1></>}
      actions={<Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New page</Button>}
      bleed
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(16rem,25%)_minmax(0,1fr)] lg:grid-rows-1">
        <div className="max-h-64 min-h-0 overflow-auto border-b lg:max-h-none lg:border-r lg:border-b-0">
          {sections.map((s) => {
            if (!s.many && s.pages.length === 0) return null;
            return (
              <div key={s.id}>
                {s.many && <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">{s.label}</div>}
                {s.pages.map(openRow)}
                {s.many && s.pages.length === 0 && <p className="px-4 py-1 text-xs text-muted-foreground">None yet.</p>}
              </div>
            );
          })}
          {other.map(openRow)}
        </div>
        <div ref={pageScroll} className="min-h-0 overflow-auto p-6">
          {doc && doc.id === selected && (
            <DocView key={doc.id} doc={doc} onChanged={() => { reload(); reloadDoc(); }} onDeleted={() => go(`wiki/${projectId}`)} />
          )}
        </div>
      </div>
      {creating && <NewDocument projectId={projectId} onClose={() => setCreating(false)} onSaved={(created) => { setCreating(false); reload(); go(`wiki/${projectId}?doc=${created.id}`); }} />}
    </Page>
  );
}
