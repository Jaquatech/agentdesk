import { useEffect, useState } from "react";
import { get, type Project } from "../api.ts";
import { Page } from "../components/page.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatasetsPanel, type DatasetPick } from "./dataFactory/DatasetsPanel.tsx";
import { ImportPanel, type ImportStatus } from "./dataFactory/ImportPanel.tsx";
import { JudgePanel } from "./dataFactory/JudgePanel.tsx";
import { ModelsPanel } from "./dataFactory/ModelsPanel.tsx";
import { ReviewPanel } from "./dataFactory/ReviewPanel.tsx";
import { ReportsPanel } from "./dataFactory/ReportsPanel.tsx";
import { RunsPanel } from "./dataFactory/RunsPanel.tsx";
import { SECTIONS, sectionFromTab, type SectionId } from "./dataFactory/sections.ts";

/** The Data factory of one project: sections as header tabs, each a list and a wide view. */
export function DataFactoryPage({ projectId, tab, run }: { projectId: number; tab?: string; run?: number }) {
  // undefined = loading, null = no such project.
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  useEffect(() => {
    get<Project[]>("/api/projects").then((list) => setProject(list.find((p) => p.id === projectId) ?? null));
  }, [projectId]);

  // Open dataset and version and the line after an import live here, so they survive a tab switch.
  const [pick, setPick] = useState<DatasetPick>({ datasetId: null, versionId: null });
  const [status, setStatus] = useState<ImportStatus | null>(null);

  if (project === undefined) return null;
  if (project === null) return <Page title="Data factory"><p className="text-sm text-muted-foreground">No such project.</p></Page>;
  if ((project as Project & { data_factory?: number }).data_factory !== 1) {
    return <Page title={project.name}><p className="text-sm text-muted-foreground">The Data factory is off for this project.</p></Page>;
  }

  const current = sectionFromTab(tab);
  const goTab = (id: SectionId) => { window.location.hash = `#/data-factory/${project.id}?tab=${id}`; };
  const tabs = (
    <Tabs value={current} onValueChange={(v) => goTab(v as SectionId)} className="ml-auto w-auto">
      <TabsList>
        {SECTIONS.map((s) => <TabsTrigger key={s.id} value={s.id}>{s.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
  return (
    <Page
      title={<><span className="text-muted-foreground">{project.name}</span><span className="text-muted-foreground">/</span><h1 className="text-sm font-medium">Data factory</h1></>}
      actions={tabs}
      bleed
    >
      {current === "import" ? (
        <ImportPanel
          projectId={project.id}
          onImported={(datasetId, versionId, s) => { setPick({ datasetId, versionId }); setStatus(s); goTab("datasets"); }}
        />
      ) : current === "datasets" ? (
        <DatasetsPanel projectId={project.id} pick={pick} onPick={setPick} status={status} onStatusDone={() => setStatus(null)} />
      ) : current === "models" ? (
        <ModelsPanel projectId={project.id} />
      ) : current === "judge" ? (
        <JudgePanel projectId={project.id} />
      ) : current === "runs" ? (
        <RunsPanel projectId={project.id} run={run} />
      ) : current === "review" ? (
        <ReviewPanel projectId={project.id} />
      ) : (
        <ReportsPanel projectId={project.id} />
      )}
    </Page>
  );
}
