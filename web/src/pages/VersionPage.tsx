import { Info } from "lucide-react";
import { Fragment } from "react";
import { useLoad } from "../api.ts";

type Version = { version: string; commit: string; notes: string };

/** The release notes are a CHANGELOG.md in the repository: "## version (date)", "### group", "- item". */
export function VersionPage() {
  const { data } = useLoad<Version>("/api/version");
  const blocks = data ? parse(data.notes) : [];
  return (
    <>
      <div className="page-head"><Info size={16} /><h1>Version</h1></div>
      <div className="page"><div className="narrow" style={{ maxWidth: 800 }}>
        {data && (
          <p>
            You are running AgentDesk <b>{data.version ? `v${data.version}` : "(unknown version)"}</b>
            {data.commit && <> · commit <span className="mono">{data.commit}</span></>}.
            {" "}To update: <span className="mono">git pull</span>, then <span className="mono">npm run setup</span> and restart.
          </p>
        )}
        {data && !data.notes && <p className="hint">No release notes found (CHANGELOG.md is missing).</p>}
        {blocks.map((b, i) => (
          <Fragment key={i}>
            {b.kind === "version" && <div className="section-title"><h2>{b.text}{data && b.text.startsWith(data.version + " ") ? <span className="hint"> · running</span> : null}</h2></div>}
            {b.kind === "group" && <h3 style={{ margin: "14px 0 4px" }}>{b.text}</h3>}
            {b.kind === "list" && <ul style={{ margin: "0 0 8px", paddingLeft: 20, display: "grid", gap: 4 }}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>}
            {b.kind === "text" && <p>{inline(b.text)}</p>}
          </Fragment>
        ))}
      </div></div>
    </>
  );
}

type Block = { kind: "version" | "group" | "text"; text: string } | { kind: "list"; items: string[] };

function parse(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || /^#\s/.test(line)) continue; // blank lines and the document title
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
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <span key={i} className="mono">{p.slice(1, -1)}</span> : p);
}
