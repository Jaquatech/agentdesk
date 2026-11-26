import { describe, expect, it } from "vitest";
import { openWikiPage, redirectTarget, wikiGroups, type DocList } from "./model.ts";

const doc = (id: number, over: Partial<DocList> = {}): DocList => ({
  id, title: `Page ${id}`, kind: "project", project_id: 1, project_name: "Orbit", builtin: null, section: "", slot: "",
  task_id: null, sprint_id: null, updated_at: "", ...over,
});

describe("wikiGroups", () => {
  it("groups pages into sections in order, with task and release pages in theirs", () => {
    const pages = [
      doc(1, { slot: "setup" }), doc(2, { section: "tasks", task_id: 5 }), doc(3, { section: "releases", sprint_id: 2 }),
      doc(4, { slot: "overview" }), doc(5, { section: "decisions" }), doc(6, { slot: "architecture" }), doc(7, { slot: "roadmap" }),
    ];
    const { sections, other } = wikiGroups(pages);
    expect(sections.map((s) => s.id)).toEqual(["overview", "architecture", "decisions", "roadmap", "releases", "setup", "tasks"]);
    expect(sections.map((s) => s.pages.map((d) => d.id))).toEqual([[4], [6], [5], [7], [3], [1], [2]]);
    expect(other).toEqual([]);
  });

  it("puts a page without section or slot in other", () => {
    const { sections, other } = wikiGroups([doc(9)]);
    expect(other.map((d) => d.id)).toEqual([9]);
    expect(sections.every((s) => s.pages.length === 0)).toBe(true);
  });
});

describe("openWikiPage", () => {
  const docs = [doc(1, { slot: "overview" }), doc(2, { section: "decisions" }), doc(3, { slot: "overview", project_id: 2 }), doc(4, { kind: "generic", project_id: null })];

  it("opens the Overview without a doc", () => expect(openWikiPage(docs, 1)?.id).toBe(1));
  it("opens the Overview for a page of another project or a General page", () => {
    expect(openWikiPage(docs, 1, 3)?.id).toBe(1);
    expect(openWikiPage(docs, 1, 4)?.id).toBe(1);
  });
  it("keeps a valid page", () => expect(openWikiPage(docs, 1, 2)?.id).toBe(2));
});

describe("redirectTarget", () => {
  it("points a project page to the wiki", () => expect(redirectTarget({ id: 12, project_id: 3 })).toBe("#/wiki/3?doc=12"));
  it("has none for a General page", () => expect(redirectTarget({ id: 12, project_id: null })).toBeNull());
});
