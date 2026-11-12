import { useEffect, useState } from "react";
import { get } from "../api.ts";
import { ToneBadge } from "./ui.tsx";

export type Caps = { model: string; vision: boolean | null; tools: boolean | null; thinking?: boolean | null; source: string; agent?: string | null };

export function useCapabilities(url: string | null) {
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    setCaps(null);
    if (!url) return;
    let alive = true;
    get<Caps>(url).then((c) => alive && setCaps(c)).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return caps;
}

const mark = (v: boolean | null) => (v === true ? "✓" : v === false ? "✗" : "?");

/** "Tools ✓ · Images ✗" under a model choice, with a warning when an agent cannot work with this model. */
export function CapabilityBadges({ caps, role }: { caps: Caps | null; role?: string }) {
  if (!caps || !caps.model) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <ToneBadge tone={caps.tools === false ? "bad" : caps.tools ? "good" : ""}>Tools {mark(caps.tools)}</ToneBadge>
      <ToneBadge tone={caps.vision ? "good" : ""}>Images {mark(caps.vision)}</ToneBadge>
      {caps.thinking != null && <ToneBadge>Thinks {mark(caps.thinking)}</ToneBadge>}
      <span className="text-muted-foreground">{caps.source}</span>
      {caps.tools === false && role && (
        <p className="w-full text-sm text-destructive">
          This model cannot call tools, so as a {role === "worker" ? "developer" : role} it cannot read files{role === "worker" ? " or edit code" : ""} here. Pick a model with tool support.
        </p>
      )}
    </div>
  );
}
