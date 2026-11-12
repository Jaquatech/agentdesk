import { useState } from "react";
import { Building2 } from "lucide-react";
import { post } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { ThemeToggle } from "../components/theme.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
    <div className="relative grid min-h-svh place-items-center bg-sidebar p-6">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Building2 className="text-warm" />
            <div>
              <CardTitle>AgentDesk</CardTitle>
              <CardDescription>{setup ? "First start: create your local account." : "Sign in to your local workspace."}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field label="Username"><Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
              <Field label="Password" hint={setup ? "At least 8 characters. Stored as a hash on this machine only." : undefined}>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} />
              </Field>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full">{setup ? "Create account" : "Sign in"}</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
