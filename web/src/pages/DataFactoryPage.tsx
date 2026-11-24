import { useEffect, useState } from "react";
import { get, type Project } from "../api.ts";
import { Page } from "../components/page.tsx";

/** The Data factory of one project. Empty for now: datasets, model runs and reports come later. */
export function DataFactoryPage({ projectId }: { projectId: number }) {
  // undefined = loading, null = no such project.
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  useEffect(() => {
    get<Project[]>("/api/projects").then((list) => setProject(list.find((p) => p.id === projectId) ?? null));
  }, [projectId]);

  if (project === undefined) return null;
  if (project === null) return <Page title="Data factory"><p className="text-sm text-muted-foreground">No such project.</p></Page>;
  return (
    <Page title={project.name}>
      <p className="text-sm text-muted-foreground">No datasets yet.</p>
    </Page>
  );
}
