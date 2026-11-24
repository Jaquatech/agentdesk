import { Cpu, Database, FileText, Play, Scale, UserCheck, type LucideIcon } from "lucide-react";

export type SectionId = "datasets" | "models" | "judge" | "runs" | "review" | "reports";

export type Section = { id: SectionId; label: string; icon: LucideIcon; description: string };

/** The Data factory sections, in menu order. */
export const SECTIONS: Section[] = [
  { id: "datasets", label: "Datasets", icon: Database, description: "Import test cases and keep each import as an immutable version." },
  { id: "models", label: "Models", icon: Cpu, description: "The models to test, with capabilities and prices, taken from this project's providers." },
  { id: "judge", label: "Judge", icon: Scale, description: "The model that scores the answers and the rubric it uses. A judge from another model family than the tested models is recommended." },
  { id: "runs", label: "Runs", icon: Play, description: "Plan a run (dataset version, models, budget, cost check, pre-flight), follow it live and read the results." },
  { id: "review", label: "Review", icon: UserCheck, description: "Vote on answers by hand. The judge's score is shown after your vote." },
  { id: "reports", label: "Reports", icon: FileText, description: "Run reports and comparisons between runs. Copy as Markdown, or export PDF, Excel and JSON." },
];

/** A valid section id for a `tab` query value; missing or unknown means datasets. */
export function sectionFromTab(tab?: string): SectionId {
  return SECTIONS.find((s) => s.id === tab)?.id ?? "datasets";
}
