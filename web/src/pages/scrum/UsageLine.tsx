import { money } from "../../components/ui.tsx";
import { type Usage, KIND, tokens } from "./model.ts";

export function UsageLine({ u, label }: { u: Usage | null; label?: string }) {
  if (!u || !u.runs) return <span className="text-xs text-muted-foreground">{label ? `${label}: ` : ""}no token use yet</span>;
  const kinds = Object.entries(u.by_kind).sort((a, b) => b[1].tokens - a[1].tokens);
  return (
    <span className="text-xs text-muted-foreground" title={kinds.map(([k, v]) => `${KIND[k] ?? k}: ${tokens(v.tokens)} tokens, ${money(v.cost)}`).join("\n")}>
      {label ? `${label}: ` : ""}<b className="text-foreground">{tokens(u.tokens)}</b> tokens · <b className="text-foreground">{money(u.cost)}</b> · {u.runs} calls
      {kinds.length > 0 && <> ({kinds.slice(0, 4).map(([k, v]) => `${KIND[k] ?? k} ${tokens(v.tokens)}`).join(", ")})</>}
    </span>
  );
}
