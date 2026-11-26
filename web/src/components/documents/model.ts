/** Types and pure helpers shared by the Documents page (General pages) and the Project wiki page. */

export type DocList = {
  id: number; title: string; kind: "generic" | "project"; project_id: number | null; project_name: string | null;
  builtin: string | null; section: string; slot: string; task_id: number | null; sprint_id: number | null; updated_at: string;
};
export type Doc = DocList & { body: string; created_at: string; links?: { id: number; title: string }[]; backlinks?: { id: number; title: string }[] };

const GENERAL_ORDER = ["guidelines", "standards", "ui", "models", "cycle"];

/** Sections of a project's wiki, in display order. `many` sections always show their heading. */
export const WIKI_SECTIONS: { id: string; label: string; many: boolean }[] = [
  { id: "overview", label: "Overview", many: false },
  { id: "architecture", label: "Architecture", many: false },
  { id: "decisions", label: "Decisions", many: true },
  { id: "roadmap", label: "Road map", many: false },
  { id: "releases", label: "Release notes", many: true },
  { id: "setup", label: "Setup", many: false },
  { id: "tasks", label: "Task pages", many: true },
];

/** General pages: builtin guides first in their fixed order, then the rest by title. */
export function generalPages(docs: DocList[] | null | undefined): DocList[] {
  return (docs ?? []).filter((d) => d.kind === "generic").sort((a, b) => {
    const ra = GENERAL_ORDER.indexOf(a.builtin ?? "");
    const rb = GENERAL_ORDER.indexOf(b.builtin ?? "");
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.title.localeCompare(b.title);
  });
}

export function projectPages(docs: DocList[] | null | undefined, projectId: number): DocList[] {
  return (docs ?? []).filter((d) => d.kind === "project" && d.project_id === projectId);
}

/** One project's pages grouped by section; pages with neither section nor slot are `other`. */
export function wikiGroups(pages: DocList[]): { sections: { id: string; label: string; many: boolean; pages: DocList[] }[]; other: DocList[] } {
  return {
    sections: WIKI_SECTIONS.map((s) => ({ ...s, pages: pages.filter((d) => d.section === s.id || d.slot === s.id) })),
    other: pages.filter((d) => !d.section && !d.slot),
  };
}

/** The page open in a project's wiki: the one asked for if it belongs to the project, otherwise the Overview. */
export function openWikiPage(docs: DocList[] | null | undefined, projectId: number, doc?: number): DocList | undefined {
  const pages = projectPages(docs, projectId);
  return pages.find((d) => d.id === doc) ?? pages.find((d) => d.slot === "overview" || d.section === "overview");
}

/** Where a page of a project lives now (old `#/documents/N` links use it); null for a General page. */
export function redirectTarget(doc: { id: number; project_id: number | null }): string | null {
  return doc.project_id == null ? null : `#/wiki/${doc.project_id}?doc=${doc.id}`;
}
