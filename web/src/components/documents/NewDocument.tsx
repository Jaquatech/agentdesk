import { useState } from "react";
import { post } from "../../api.ts";
import { Field, FooterGap, Modal } from "../ui.tsx";
import { Choice, NoFillInput } from "../inputs.tsx";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Doc } from "./model.ts";

/** The New page dialog. With `projectId` the page goes into that project's wiki (with a section); without it, it is a General page. */
export function NewDocument({ projectId, onClose, onSaved }: { projectId?: number; onClose: () => void; onSaved: (d: Doc) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [section, setSection] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      onSaved(await post<Doc>("/api/documents", { title, body, project_id: projectId ?? null, section: projectId ? section : "" }));
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title="New page" onClose={onClose} wide footer={<><FooterGap /><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!title.trim()}>Create</Button></>}>
      <Field label="Title" hint={projectId ? "Overview, Architecture, Road map, and Setup already exist: open them to edit." : "General pages stay free of project, data, and customer names."}>
        <NoFillInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this page is about" />
      </Field>
      {projectId != null && (
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
