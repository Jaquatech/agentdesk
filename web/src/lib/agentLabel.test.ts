import { describe, expect, it } from "vitest";
import { agentLabel, specialty } from "./agentLabel.ts";

describe("agent labels", () => {
  it("adds the role, and the specialty when the instructions name one", () => {
    expect(agentLabel({ name: "Frida", role: "worker", context: "Specialty: frontend (HTML, CSS, React, accessibility)\n\nYou are a developer." })).toBe("Frida (developer · frontend)");
    expect(agentLabel({ name: "Arttu", role: "planner", context: "You are the architect of a small AI development team." })).toBe("Arttu (planner)");
    expect(agentLabel({ name: "Pekka", role: "reviewer", context: "" })).toBe("Pekka (reviewer)");
  });
  it("reads the Specialty line wherever it is and keeps it short", () => {
    expect(specialty("Intro\nspecialty: Scrum product manager (backlog, stories)")).toBe("Scrum product manager");
    expect(specialty("Specialty: data.")).toBe("data");
    expect(specialty("Specialty: " + "x".repeat(80))).toHaveLength(40);
    expect(specialty(undefined)).toBe("");
  });
});
