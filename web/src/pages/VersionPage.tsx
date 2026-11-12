import { Fragment } from "react";
import { useLoad } from "../api.ts";
import { Page } from "../components/page.tsx";
import { Badge } from "@/components/ui/badge";

type Version = { version: string; commit: string; notes: string };

/** The release notes are a CHANGELOG.md in the repository: "## version (date)", "### group", "- item". */
export function VersionPage() {
  const { data } = useLoad<Version>("/api/version");
  const blocks = data ? parse(data.notes) : [];
  return (
    <Page title="Version">
      {data && (
        <p className="text-sm">
          You are running AgentDesk <b>{data.version ? `v${data.version}` : "(unknown version)"}</b>
          {data.commit && <> · commit <span className="font-mono text-xs">{data.commit}</span></>}.
          {" "}To update: <span className="font-mono text-xs">git pull</span>, then <span className="font-mono text-xs">npm run setup</span> and restart.
        </p>
      )}
      {data && !data.notes && <p className="text-sm text-muted-foreground">No release notes found (CHANGELOG.md is missing).</p>}
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.kind === "version" && (
            <h2 className="mt-2 text-sm font-medium">
              {b.text}
              {data && b.text.startsWith(data.version + " ") ? <Badge variant="secondary" className="ml-2">running</Badge> : null}
            </h2>
          )}
          {b.kind === "group" && <h3 className="text-sm font-medium">{b.text}</h3>}
          {b.kind === "list" && <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>}
          {b.kind === "text" && <p className="text-sm">{inline(b.text)}</p>}
        </Fragment>
      ))}
    </Page>
  );
}

type Block = { kind: "version" | "group" | "text"; text: string } | { kind: "list"; items: string[] };

function parse(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || /^#\s/.test(line)) continue;
    if (line.startsWith("## ")) out.push({ kind: "version", text: line.slice(3) });
    else if (line.startsWith("### ")) out.push({ kind: "group", text: line.slice(4) });
    else if (/^[-*]\s/.test(line)) {
      const last = out[out.length - 1];
      if (last?.kind === "list") last.items.push(line.slice(2));
      else out.push({ kind: "list", items: [line.slice(2)] });
    } else out.push({ kind: "text", text: line });
  }
  return out;
}

/** **bold** and `code` only. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <span key={i} className="font-mono text-xs">{p.slice(1, -1)}</span> : p);
}
