import { useEffect, useState } from "react";
import { get, type Project } from "../api.ts";
import { Page } from "../components/page.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DatasetsPanel } from "./dataFactory/DatasetsPanel.tsx";
import { SECTIONS, sectionFromTab } from "./dataFactory/sections.ts";

/** The Data factory of one project: a side menu of sections and a work area. */
export function DataFactoryPage({ projectId, tab }: { projectId: number; tab?: string }) {
  // undefined = loading, null = no such project.
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  useEffect(() => {
    get<Project[]>("/api/projects").then((list) => setProject(list.find((p) => p.id === projectId) ?? null));
  }, [projectId]);

  if (project === undefined) return null;
  if (project === null) return <Page title="Data factory"><p className="text-sm text-muted-foreground">No such project.</p></Page>;
  if ((project as Project & { data_factory?: number }).data_factory !== 1) {
    return <Page title={project.name}><p className="text-sm text-muted-foreground">The Data factory is off for this project.</p></Page>;
  }

  const current = sectionFromTab(tab);
  const section = SECTIONS.find((s) => s.id === current)!;
  return (
    <Page title={project.name} bleed>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Data factory sections" className="flex shrink-0 gap-1 overflow-auto border-b p-2 md:w-56 md:flex-col md:border-b-0 md:border-r">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#/data-factory/${project.id}?tab=${s.id}`}
              aria-current={s.id === current ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4",
                s.id === current && "bg-accent font-medium text-accent-foreground",
              )}
            >
              <s.icon /> <span>{s.label}</span>
            </a>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-6">
          {current === "datasets" ? <DatasetsPanel projectId={project.id} /> : (
            <Card>
              <CardHeader>
                <CardTitle>{section.label}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Not built yet.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
