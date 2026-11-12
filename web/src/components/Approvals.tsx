import { useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { get, post, useLiveEvents, type Approval } from "../api.ts";
import { go } from "../App.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <div className="flex max-h-[45vh] shrink-0 flex-col gap-px overflow-auto border-b bg-border">
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
    <div className="flex items-start gap-3 bg-warning/10 px-4 py-2.5 text-sm">
      <Hand className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div><b>{a.agent ?? "An agent"}</b> wants to run a command that is not on its allowed list
          {a.task && <> · <a href={a.chat_id ? `#/chat/${a.chat_id}?tab=tasks` : "#/tasks"} onClick={(e) => { if (a.chat_id) { e.preventDefault(); go(`chat/${a.chat_id}?tab=tasks`); } }}>{a.task}</a></>}
          {a.project && <span className="text-muted-foreground"> · {a.project}</span>}
        </div>
        <pre className="my-1.5 rounded-md border bg-card px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap break-all">{a.request}</pre>
        <div className="font-mono text-xs text-muted-foreground" title="Runs in this folder">in {a.cwd}</div>
        {always && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Always allow {a.agent} commands starting with</span>
            <Input className="w-64 font-mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            <Button size="sm" disabled={busy || !prefix.trim()} onClick={() => answer(true, true)}>Save rule and run</Button>
            <Button size="sm" variant="outline" onClick={() => setAlways(false)}>Cancel</Button>
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>
      {!always && (
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => answer(true)}>Allow once</Button>
          <Button size="sm" variant="outline" disabled={busy || onceOnly} title={onceOnly ? "Commands with pipes or redirects can only be allowed once" : undefined} onClick={() => setAlways(true)}>Always allow…</Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => answer(false)}>Deny</Button>
        </div>
      )}
    </div>
  );
}
