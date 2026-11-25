import type { Agent } from "../api.ts";

/** The role as people say it: a "worker" is a developer. */
export function roleName(role: Agent["role"]): string {
  return role === "worker" ? "developer" : role;
}

/**
 * The short kind of work from the "Specialty:" line the gallery agents start with
 * ("Specialty: frontend (HTML, CSS, React)" → "frontend"); "" when there is none.
 */
export function specialty(context: string | null | undefined): string {
  const line = /^\s*Specialty:\s*(.*)$/im.exec(context ?? "")?.[1] ?? "";
  return line.split("(")[0].trim().replace(/[.,;:]+$/, "").slice(0, 40);
}

/** "Frida (developer · frontend)": names alone are hard to tell apart until you know the team. */
export function agentLabel(a: Pick<Agent, "name" | "role" | "context">): string {
  const kind = specialty(a.context);
  return `${a.name} (${roleName(a.role)}${kind ? ` · ${kind}` : ""})`;
}
