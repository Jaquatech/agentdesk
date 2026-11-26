import { useState } from "react";
import Markdown from "react-markdown";
import { del, put } from "../../api.ts";
import { Field } from "../ui.tsx";
import { NoFillInput } from "../inputs.tsx";
import { ModelGuide } from "../../pages/ModelGuidePage.tsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { Doc } from "./model.ts";

/** One page with Edit and Delete, its links and backlinks. `onChanged` reloads lists; `onDeleted` decides what opens next. */
export function DocView({ doc, onChanged, onDeleted }: { doc: Doc; onChanged: () => void; onDeleted: () => void }) {
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
    onDeleted();
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{doc.kind === "project" ? doc.project_name ?? "Project" : "General"}</Badge>
        {doc.builtin && <Badge variant="outline">Guide</Badge>}
        {doc.task_id && <a className="text-xs" href={`#/tasks?task=${doc.task_id}`}>Open task</a>}
        {doc.sprint_id && doc.project_id && <a className="text-xs" href={`#/scrum/${doc.project_id}?tab=releases&sprint=${doc.sprint_id}`}>Open sprint</a>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTitle(doc.title); setBody(doc.body); setEditing((v) => !v); }}>{editing ? "Cancel" : "Edit"}</Button>
          {!doc.builtin && !doc.slot && !doc.task_id && !doc.sprint_id && <Button variant="destructive" size="sm" onClick={remove}>Delete</Button>}
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
