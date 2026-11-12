import { useState } from "react";
import Markdown from "react-markdown";
import { FileText, Plus } from "lucide-react";
import { del, post, put, type Project } from "../api.ts";
import { useLiveEvents, useLoad } from "../api.ts";
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
  builtin: string | null; section: string; slot: string; task_id: number | null; updated_at: string;
};
type Doc = DocList & { body: string; created_at: string; links?: { id: number; title: string }[]; backlinks?: { id: number; title: string }[] };

const GENERAL_ORDER = ["guidelines", "models", "cycle"];
const SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "decisions", label: "Decisions" },
  { id: "roadmap", label: "Road map" },
  { id: "releases", label: "Release notes" },
  { id: "setup", label: "Setup" },
  { id: "tasks", label: "Task pages" },
];

/** Documents: project pages and shared guides, stored in the database. */
export function DocumentsPage({ id, builtin }: { id?: number; builtin?: string }) {
  const { data: docs, reload } = useLoad<DocList[]>("/api/documents");
  const { data: projects } = useLoad<Project[]>("/api/projects");
  const [creating, setCreating] = useState(false);
  const selected = id ?? docs?.find((d) => d.builtin === builtin)?.id;
  const { data: doc, reload: reloadDoc } = useLoad<Doc>(selected ? `/api/documents/${selected}` : null);
  useLiveEvents((ev) => { if (ev.type === "task" && doc?.task_id === ev.task.id) reloadDoc(); });

  return (
    <Page title={<><FileText /> Documents</>} actions={<Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New page</Button>} bleed>
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="overflow-auto border-r">
          <Group label="General">
            {generalPages(docs).map((d) => <Row key={d.id} doc={d} active={d.id === selected} />)}
          </Group>
          <Group label="Projects">
            {projectGroups(docs).map((g) => <ProjectTree key={g.id} group={g} selected={selected} />)}
            {docs && projectGroups(docs).length === 0 && <p className="px-4 py-2 text-xs text-muted-foreground">No projects yet.</p>}
          </Group>
        </div>
        <div className="min-h-0 overflow-auto p-6">
          {!selected && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Project notes and shared guides</EmptyTitle>
                <EmptyDescription>General pages have no project. Each project has its own pages: overview, architecture, decisions, road map, release notes, setup, and one page per task.</EmptyDescription>
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

function generalPages(docs: DocList[] | null) {
  return (docs ?? []).filter((d) => d.kind === "generic").sort((a, b) => {
    const ra = GENERAL_ORDER.indexOf(a.builtin ?? "");
    const rb = GENERAL_ORDER.indexOf(b.builtin ?? "");
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.title.localeCompare(b.title);
  });
}

function projectGroups(docs: DocList[] | null) {
  const groups = new Map<number, { id: number; name: string; docs: DocList[] }>();
  for (const d of docs ?? []) {
    if (d.kind !== "project" || d.project_id == null) continue;
    const g = groups.get(d.project_id) ?? { id: d.project_id, name: d.project_name ?? "Project", docs: [] };
    g.docs.push(d);
    groups.set(d.project_id, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ProjectTree({ group, selected }: { group: { id: number; name: string; docs: DocList[] }; selected?: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pb-1">
      <button type="button" className="flex w-full items-center gap-1 px-4 py-1.5 text-left text-sm font-medium" onClick={() => setOpen((v) => !v)}>
        <span className={cn("text-xs text-muted-foreground", open && "rotate-90")}>▸</span>
        <span className="truncate">{group.name}</span>
      </button>
      {open && SECTIONS.map((s) => {
        const pages = group.docs.filter((d) => d.section === s.id || d.slot === s.id);
        const many = s.id === "decisions" || s.id === "releases" || s.id === "tasks";
        if (!many && pages.length === 0) return null;
        return (
          <div key={s.id} className="pl-4">
            {many ? <div className="px-4 pt-1 text-xs text-muted-foreground">{s.label}</div> : null}
            {pages.map((d) => <Row key={d.id} doc={d} active={d.id === selected} nested />)}
            {many && pages.length === 0 && <p className="px-4 py-1 text-xs text-muted-foreground">None yet.</p>}
          </div>
        );
      })}
      {group.docs.filter((d) => !d.section && !d.slot).map((d) => <Row key={d.id} doc={d} active={d.id === selected} nested />)}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Row({ doc, active, nested }: { doc: DocList; active: boolean; nested?: boolean }) {
  return (
    <button type="button" onClick={() => go(`documents/${doc.id}`)} className={cn("flex w-full flex-col gap-0.5 border-b px-4 py-2 text-left hover:bg-muted", nested && "pl-6", active && "bg-accent")}>
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
        <Badge variant="secondary">{doc.kind === "project" ? doc.project_name ?? "Project" : "General"}</Badge>
        {doc.builtin && <Badge variant="outline">Guide</Badge>}
        {doc.task_id && <a className="text-xs" href={`#/tasks?task=${doc.task_id}`}>Open task</a>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTitle(doc.title); setBody(doc.body); setEditing((v) => !v); }}>{editing ? "Cancel" : "Edit"}</Button>
          {!doc.builtin && !doc.slot && !doc.task_id && <Button variant="destructive" size="sm" onClick={remove}>Delete</Button>}
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
          {(doc.backlinks?.length || doc.links?.length) ? (
            <div className="flex flex-col gap-2 text-sm">
              {!!doc.links?.length && <p>Links: {doc.links.map((l) => <a key={l.id} className="mr-3" href={`#/documents/${l.id}`}>{l.title}</a>)}</p>}
              {!!doc.backlinks?.length && <p>Backlinks: {doc.backlinks.map((l) => <a key={l.id} className="mr-3" href={`#/documents/${l.id}`}>{l.title}</a>)}</p>}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function NewDocument({ projects, onClose, onSaved }: { projects: Project[]; onClose: () => void; onSaved: (d: Doc) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const [section, setSection] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      const created = await post<Doc>("/api/documents", { title, body, project_id: projectId ? Number(projectId) : null, section: projectId ? section : "" });
      onSaved(created);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title="New page" onClose={onClose} wide footer={<><FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!title.trim()}>Create</Button></>}>
      <Field label="Title"><NoFillInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this page is about" /></Field>
      <Field label="Where" hint="General pages stay free of project, data, and customer names. Overview, Architecture, Road map, and Setup already exist for each project: open them to edit.">
        <Choice value={projectId} onValueChange={(v) => { setProjectId(v); if (!v) setSection(""); }} options={[{ value: "", label: "General" }, ...projects.map((p) => ({ value: String(p.id), label: p.name }))]} />
      </Field>
      {projectId && (
        <Field label="Section">
          <Choice value={section} onValueChange={setSection} options={[{ value: "", label: "Other" }, { value: "decisions", label: "Decisions" }, { value: "releases", label: "Release notes" }]} />
        </Field>
      )}
      <Field label="Page" hint="Markdown. Everyone who can open AgentDesk can read it.">
        <Textarea className="min-h-40 font-mono text-xs" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
