import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Page frame: header with the sidebar trigger, then a scrolling body. */
export function Page({ title, actions, children, width = "narrow", bleed }: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: "narrow" | "wide" | "full";
  /** Fill the body edge to edge (split views). */
  bleed?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
        <SidebarTrigger />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">{title}</div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", bleed ? "flex flex-col overflow-hidden" : "overflow-auto")}>
        <div className={cn(
          "flex flex-col gap-4",
          bleed ? "h-full min-h-0" : "p-6",
          !bleed && width === "narrow" && "mx-auto w-full max-w-4xl",
          !bleed && width === "wide" && "mx-auto w-full max-w-6xl",
        )}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Section({ title, hint, action, children }: {
  title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}
