import { useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { get, post, useLiveEvents, type Approval } from "../api.ts";
import { go } from "../App.tsx";

/** Default rule for "Always allow": the command's first two words (e.g. "npm install"). */
export function suggestPrefix(command: string) {
  return command.trim().split(/\s+/).slice(0, 2).join(" ");
}
const hasShellOps = (c: string) => /[|><`]|\$\(/.test(c);

/**
 * Commands agents want to run outside their allowed list. The run waits here until someone answers.
 * Shown at the top of every page; the browser tab shows how many are waiting.
 */
export function ApprovalsBar() {
  const [pending, setPending] = useState<Approval[]>([]);
  useEffect(() => { get<Approval[]>("/api/approvals?pending=1").then(setPending); }, []);
  useLiveEvents((ev) => {
    if (ev.type !== "approval") return;
    setPending((list) => {
      const rest = list.filter((a) => a.id !== ev.approval.id);
      return ev.approval.status === "pending" ? [ev.approval, ...rest] : rest;
    });
  });
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = pending.length ? `(${pending.length}) ${base}` : base;
  }, [pending.length]);

  if (!pending.length) return null;
  return (
    <div className="approvals">
      {pending.map((a) => <ApprovalItem key={a.id} a={a} />)}
    </div>
  );
}

function ApprovalItem({ a }: { a: Approval }) {
  const [always, setAlways] = useState(false);
  const [prefix, setPrefix] = useState(suggestPrefix(a.request));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = async (allow: boolean, keep = false) => {
    setBusy(true); setError("");
    try { await post(`/api/approvals/${a.id}`, { allow, always: keep, prefix: keep ? prefix : undefined }); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const onceOnly = hasShellOps(a.request);
  return (
    <div className="approval">
      <Hand size={18} className="approval-icon" />
      <div className="approval-main">
        <div><b>{a.agent ?? "An agent"}</b> wants to run a command that is not on its allowed list
          {a.task && <> · <a href={a.chat_id ? `#/chat/${a.chat_id}?tab=tasks` : "#/tasks"} onClick={(e) => { if (a.chat_id) { e.preventDefault(); go(`chat/${a.chat_id}?tab=tasks`); } }}>{a.task}</a></>}
          {a.project && <span className="hint"> · {a.project}</span>}
        </div>
        <pre className="approval-cmd">{a.request}</pre>
        <div className="hint mono" title="Runs in this folder">in {a.cwd}</div>
        {always && (
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span className="hint">Always allow {a.agent} commands starting with</span>
            <input className="mono" style={{ width: 260 }} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            <button className="btn small primary" disabled={busy || !prefix.trim()} onClick={() => answer(true, true)}>Save rule and run</button>
            <button className="btn small" onClick={() => setAlways(false)}>Cancel</button>
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
      {!always && (
        <div className="approval-actions">
          <button className="btn small primary" disabled={busy} onClick={() => answer(true)}>Allow once</button>
          <button className="btn small" disabled={busy || onceOnly} title={onceOnly ? "Commands with pipes or redirects can only be allowed once" : undefined} onClick={() => setAlways(true)}>Always allow…</button>
          <button className="btn small danger" disabled={busy} onClick={() => answer(false)}>Deny</button>
        </div>
      )}
    </div>
  );
}
