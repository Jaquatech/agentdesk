import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useLiveEvents, useLoad } from "../api.ts";
import { go } from "../App.tsx";
import { Page } from "../components/page.tsx";
import { DocRow } from "../components/documents/DocRow.tsx";
import { DocView } from "../components/documents/DocView.tsx";
import { NewDocument } from "../components/documents/NewDocument.tsx";
import { generalPages, redirectTarget, type Doc, type DocList } from "../components/documents/model.ts";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** Documents: the General pages (shared guides), stored in the database. A project's pages are in its Project wiki. */
export function DocumentsPage({ id, builtin }: { id?: number; builtin?: string }) {
  const { data: docs, reload } = useLoad<DocList[]>("/api/documents");
  const [creating, setCreating] = useState(false);
  const general = generalPages(docs);
  // An old link to a project page moves to the wiki; replace keeps Back from returning to this address.
  const target = id != null ? docs?.find((d) => d.id === id) : undefined;
  const redirect = target ? redirectTarget(target) : null;
  useEffect(() => { if (redirect) location.replace(redirect); }, [redirect]);
  const selected = redirect ? undefined : id ?? general.find((d) => d.builtin === builtin)?.id;
  const { data: doc, reload: reloadDoc } = useLoad<Doc>(selected ? `/api/documents/${selected}` : null);
  useLiveEvents((ev) => { if (ev.type === "task" && doc?.task_id === ev.task.id) reloadDoc(); });
  const pageScroll = useRef<HTMLDivElement>(null);
  const shown = useRef<number | undefined>(undefined);
  // A new page starts at the top. A refresh of the page already open keeps the place the reader stopped.
  useLayoutEffect(() => {
    if (shown.current === selected) return;
    shown.current = selected;
    if (pageScroll.current) pageScroll.current.scrollTop = 0;
  }, [selected]);

  return (
    <Page title={<><FileText /> Documents</>} actions={<Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New page</Button>} bleed>
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="min-h-0 overflow-auto border-r">
          <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">General</div>
          {general.map((d) => <DocRow key={d.id} doc={d} active={d.id === selected} onOpen={() => go(`documents/${d.id}`)} />)}
        </div>
        <div ref={pageScroll} className="min-h-0 overflow-auto p-6">
          {!selected && !redirect && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Project notes and shared guides</EmptyTitle>
                <EmptyDescription>Shared guides for every project. A project's own pages are under the project in the sidebar: Project wiki.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {doc && doc.id === selected && <DocView key={doc.id} doc={doc} onChanged={() => { reload(); reloadDoc(); }} onDeleted={() => go("documents")} />}
        </div>
      </div>
      {creating && <NewDocument onClose={() => setCreating(false)} onSaved={(created) => { setCreating(false); reload(); go(`documents/${created.id}`); }} />}
    </Page>
  );
}
