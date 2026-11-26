import { cn } from "@/lib/utils";
import type { DocList } from "./model.ts";

/** One page in a list of pages. */
export function DocRow({ doc, active, nested, onOpen }: { doc: DocList; active: boolean; nested?: boolean; onOpen: () => void }) {
  return (
    <button type="button" aria-current={active ? "true" : undefined} onClick={onOpen} className={cn("flex w-full flex-col gap-0.5 border-b px-4 py-2 text-left hover:bg-muted", nested && "pl-6", active && "bg-accent")}>
      <span className="truncate text-sm font-medium">{doc.title}</span>
      {doc.builtin && <span className="text-xs text-muted-foreground">Guide</span>}
    </button>
  );
}
