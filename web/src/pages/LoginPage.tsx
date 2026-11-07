import { useState } from "react";
import { Building2 } from "lucide-react";
import { post } from "../api.ts";
import { Field } from "../components/ui.tsx";

export function LoginPage({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await post(setup ? "/api/auth/setup" : "/api/auth/login", { username, password });
      onDone();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 16 }}>
          <Building2 size={26} color="#e8b04b" />
          <div>
            <h1>AgentDesk</h1>
            <div className="hint">{setup ? "First start: create your local account." : "Sign in to your local workspace."}</div>
          </div>
        </div>
        <Field label="Username"><input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password" hint={setup ? "At least 8 characters. Stored as a hash on this machine only." : undefined}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} />
        </Field>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }}>{setup ? "Create account" : "Sign in"}</button>
      </form>
    </div>
  );
}
