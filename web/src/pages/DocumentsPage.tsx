import { useState } from "react";
import Markdown from "react-markdown";
import { FileText, Plus } from "lucide-react";
import { del, post, put, type Project } from "../api.ts";
import { useLoad } from "../api.ts";
import { go } from "../App.tsx";
import { Field, FooterGap, Modal } from "../components/ui.tsx";
import { Choice, NoFillInput } from "../components/inputs.tsx";
import { Page } from "../components/page.tsx";
import { ModelGuide } from "./ModelGuidePage.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type DocList = {
  id: number; title: string; kind: "generic" | "project"; project_id: number | null; project_name: string | null;
  builtin: string | null; updated_at: string;
};
type Doc = DocList & { body: string; created_at: string };

/** Documents: project pages and shared guides, stored in the database. */
export function DocumentsPage({ id, builtin }: { id?: number; builtin?: string }) {
  const { data: docs, reload } = useLoad<DocList[]>("/api/documents");
  const { data: projects } = useLoad<Project[]>("/api/projects");
  const [creating, setCreating] = useState(false);
  const selected = id ?? docs?.find((d) => d.builtin === builtin)?.id;
  const { data: doc, reload: reloadDoc } = useLoad<Doc>(selected ? `/api/documents/${selected}` : null);

  return (
    <Page title={<><FileText /> Documents</>} actions={<Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New page</Button>} bleed>
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="overflow-auto border-r">
          {!docs?.length && <p className="px-4 py-3 text-sm text-muted-foreground">No pages yet.</p>}
          <Group label="Shared">
            {docs?.filter((d) => d.kind === "generic").map((d) => <Row key={d.id} doc={d} active={d.id === selected} />)}
          </Group>
          {projectGroups(docs).map((g) => (
            <Group key={g.id} label={g.name}>
              {g.docs.map((d) => <Row key={d.id} doc={d} active={d.id === selected} />)}
            </Group>
          ))}
        </div>
        <div className="min-h-0 overflow-auto p-6">
          {!selected && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Project notes and shared guides</EmptyTitle>
                <EmptyDescription>Pages live in the local database. A project page belongs to one project. A shared page is a guideline with no project.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {doc && doc.id === selected && <DocView key={doc.id} doc={doc} onChanged={() => { reload(); reloadDoc(); }} />}
        </div>
      </div>
      {creating && <NewDocument projects={projects ?? []} onClose={() => setCreating(false)} onSaved={(created) => { setCreating(false); reload(); go(`documents/${created.id}`); }} />}
    </Page>
  );
}

function projectGroups(docs: DocList[] | null) {
  const groups = new Map<number, { id: number; name: string; docs: DocList[] }>();
  for (const d of docs ?? []) {
    if (d.kind !== "project" || d.project_id == null) continue;
    const g = groups.get(d.project_id) ?? { id: d.project_id, name: d.project_name ?? "Project", docs: [] };
    g.docs.push(d);
    groups.set(d.project_id, g);
  }
  return [...groups.values()];
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Row({ doc, active }: { doc: DocList; active: boolean }) {
  return (
    <button type="button" onClick={() => go(`documents/${doc.id}`)} className={cn("flex w-full flex-col gap-0.5 border-b px-4 py-2.5 text-left hover:bg-muted", active && "bg-accent")}>
      <span className="truncate text-sm font-medium">{doc.title}</span>
      {doc.builtin && <span className="text-xs text-muted-foreground">Guide</span>}
    </button>
  );
}

function DocView({ doc, onChanged }: { doc: Doc; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      await put(`/api/documents/${doc.id}`, { title, body });
      setEditing(false);
      onChanged();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`Delete “${doc.title}”?`)) return;
    await del(`/api/documents/${doc.id}`);
    onChanged();
    go("documents");
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{doc.kind === "project" ? doc.project_name ?? "Project" : "Shared"}</Badge>
        {doc.builtin && <Badge variant="outline">Guide</Badge>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTitle(doc.title); setBody(doc.body); setEditing((v) => !v); }}>{editing ? "Cancel" : "Edit"}</Button>
          {!doc.builtin && <Button variant="destructive" size="sm" onClick={remove}>Delete</Button>}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <Field label="Title"><NoFillInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Page"><Textarea className="min-h-64 font-mono text-xs" rows={16} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div><Button onClick={save} disabled={!title.trim()}>Save</Button></div>
        </div>
      ) : (
        <>
          <h2 className="text-lg font-medium">{doc.title}</h2>
          <div className="markdown text-sm"><Markdown>{doc.body}</Markdown></div>
          {doc.builtin === "models" && <ModelGuide />}
        </>
      )}
    </div>
  );
}

function NewDocument({ projects, onClose, onSaved }: { projects: Project[]; onClose: () => void; onSaved: (d: Doc) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      const created = await post<Doc>("/api/documents", { title, body, project_id: projectId ? Number(projectId) : null });
      onSaved(created);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title="New page" onClose={onClose} wide footer={<><FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!title.trim()}>Create</Button></>}>
      <Field label="Title"><NoFillInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this page is about" /></Field>
      <Field label="Belongs to" hint="Shared pages have no project. A project page is only about that project.">
        <Choice value={projectId} onValueChange={setProjectId} options={[{ value: "", label: "Shared — no project" }, ...projects.map((p) => ({ value: String(p.id), label: p.name }))]} />
      </Field>
      <Field label="Page" hint="Markdown. Everyone who can open AgentDesk can read it.">
        <Textarea className="min-h-40 font-mono text-xs" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
