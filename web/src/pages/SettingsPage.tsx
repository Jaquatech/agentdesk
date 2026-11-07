import { useEffect, useState } from "react";
import { get, post, put, del } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { OFFICE_STYLES } from "../office/palette.ts";


export function SettingsPage({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState("");
  const [user, setUser] = useState({ username: "", password: "" });
  const [pw, setPw] = useState({ current: "", password: "" });
  const [msg, setMsg] = useState("");
  const [cache, setCache] = useState<{ folder: string; files: number; bytes: number } | null>(null);
  const loadCache = () => get<{ folder: string; files: number; bytes: number }>("/api/attachments-cache").then(setCache);
  useEffect(() => { loadCache(); }, []);
  const clearCache = async () => {
    if (!confirm(`Delete ${cache?.files} cached file(s)? Chats keep their text; their images show as removed.`)) return;
    await del("/api/attachments-cache");
    loadCache();
  };
  const size = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

  useEffect(() => {
    get("/api/settings").then(setS);
  }, []);
  if (!s) return null;
  const set = (k: string, v: string) => setS({ ...s, [k]: v });
  const save = async () => { setS(await put("/api/settings", s)); setSaved("Saved"); onChanged(); setTimeout(() => setSaved(""), 2000); };
  const act = async (fn: () => Promise<unknown>, ok: string) => { setMsg(""); try { await fn(); setMsg(ok); } catch (e) { setMsg((e as Error).message); } };

  return (
    <>
      <div className="page-head"><h1>Settings</h1><span className="spacer" /><span className="hint">{saved}</span><button className="btn primary" onClick={save}>Save</button></div>
      <div className="page"><div className="narrow">
        <div className="section-title"><h2>Office</h2></div>
        <div className="card card-pad">
          <div className="grid2">
            <Field label="Company name" hint="Shown on the office wall and in the sidebar."><input autoComplete="off" value={s.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
            <Field label="Office style">
              <select value={s.office_style} onChange={(e) => set("office_style", e.target.value)}>
                {Object.entries(OFFICE_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {(() => { const o = OFFICE_STYLES[s.office_style] ?? OFFICE_STYLES.nordic; return [o.wall, o.floorA, o.desk, o.sofa, o.rug, o.sign].map((c, i) => <span key={i} className="swatch" style={{ background: c, width: 28, height: 18 }} />); })()}
          </div>
        </div>

        <div className="section-title"><h2>Work</h2></div>
        <div className="card card-pad">
          <div className="hint" style={{ marginBottom: 10 }}>Who plans, builds and reviews is set per team on the <a href="#/teams">Teams</a> page; each project picks its team.</div>
          <div className="grid2">
            <Field label="Tasks running at the same time" hint="Each developer works on one task at a time."><input type="number" min={1} max={8} value={s.max_parallel} onChange={(e) => set("max_parallel", e.target.value)} /></Field>
            <Field label="Fix rounds after a failed check or review" hint="Then the task waits for you."><input type="number" min={0} max={5} value={s.max_review_rounds} onChange={(e) => set("max_review_rounds", e.target.value)} /></Field>
          </div>
          <label className="row" style={{ gap: 8, marginBottom: 6 }}><input type="checkbox" checked={s.auto_run_plans === "true"} onChange={(e) => set("auto_run_plans", String(e.target.checked))} /> Run plans right away (otherwise you press "Run plan")</label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={s.push_and_pr === "true"} onChange={(e) => set("push_and_pr", String(e.target.checked))} /> Push approved branches and open a pull request (projects with a remote)</label>
        </div>

        <div className="section-title"><h2>Spending limits</h2></div>
        <div className="card card-pad">
          <div className="grid2">
            <Field label="Per day (USD, 0 = no limit)" hint="All agent calls since midnight. Queued tasks wait; a call that would start is refused.">
              <input type="number" min={0} step={1} value={s.budget_day_usd ?? "0"} onChange={(e) => set("budget_day_usd", e.target.value)} />
            </Field>
            <Field label="Per sprint (USD, 0 = no limit)" hint="One sprint including refinement of its items. Applies to Scrum projects.">
              <input type="number" min={0} step={1} value={s.budget_sprint_usd ?? "0"} onChange={(e) => set("budget_sprint_usd", e.target.value)} />
            </Field>
          </div>
          <div className="hint">Only finished calls are counted, so a running call can go a little over. Local models and models with no price in <a href="#/usage">Usage</a> count as $0. A warning shows from 80%.</div>
        </div>

        <div className="section-title"><h2>Attachment cache</h2></div>
        <div className="card card-pad">
          {cache ? (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ wordBreak: "break-all" }}>{cache.folder}</div>
                <div className="hint">{cache.files} file{cache.files === 1 ? "" : "s"} · {size(cache.bytes)} · screenshots and files pasted into chats</div>
              </div>
              <button className="btn danger" disabled={!cache.files} onClick={clearCache}>Clear cache</button>
            </div>
          ) : <div className="hint">Loading…</div>}
        </div>

        <div className="section-title"><h2>Accounts on this machine</h2></div>
        <div className="card card-pad">
          <div className="grid3">
            <Field label="New user"><input autoComplete="off" value={user.username} onChange={(e) => setUser({ ...user, username: e.target.value })} /></Field>
            <Field label="Password"><input type="password" autoComplete="new-password" value={user.password} onChange={(e) => setUser({ ...user, password: e.target.value })} /></Field>
            <Field label=" "><button className="btn" onClick={() => act(() => post("/api/users", user), "User added")}>Add user</button></Field>
            <Field label="Your current password"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password"><input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
            <Field label=" "><button className="btn" onClick={() => act(() => post("/api/users/me/password", pw), "Password changed")}>Change password</button></Field>
          </div>
          {msg && <div className="hint">{msg}</div>}
        </div>
      </div></div>
    </>
  );
}
