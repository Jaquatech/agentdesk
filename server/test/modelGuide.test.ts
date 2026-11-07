import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db.ts";
import { advise, classify, guessWork } from "../src/modelGuide.ts";

const db = openDb(join(mkdtempSync(join(tmpdir(), "ad-guide-")), "t.db"));
const names = (r: { rows: { model: string }[] }) => r.rows.map((x) => x.model);

describe("model guide", () => {
  it("knows the Claude family: Haiku for code, not UI; Sonnet for planning and review", () => {
    const haiku = classify("claude-haiku-5-5-20260301")!;
    expect(haiku.id).toBe("haiku");
    expect(haiku.ratings.backend).toBe(2);
    expect(haiku.ratings.ui).toBe(1);
    expect(haiku.seen).toContain("ui"); // seen in real runs, not guessed
    expect(classify("sonnet")!.seen).toEqual(["planning", "review"]);
    expect(classify("anthropic/claude-opus-5-5")!.id).toBe("opus");
  });

  it("recommends per role from the provider's own models, one entry per model and the starter first", () => {
    const models = ["claude-opus-5-5", "claude-haiku-5-5", "claude-haiku-5-5-20260301", "claude-sonnet-5-5"];
    const planner = advise(db, { kind: "anthropic", models, role: "planner" });
    expect(names(planner)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]); // Haiku is limited for planning
    expect(planner.rows[0].start).toBe(true);
    expect(names(advise(db, { kind: "anthropic", models, role: "worker", work: "backend" }))).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(names(advise(db, { kind: "anthropic", models, role: "worker", work: "ui" }))[0]).toBe("claude-sonnet-5-5");
    expect(names(advise(db, { kind: "anthropic", models, role: "reviewer" }))[0]).toBe("claude-sonnet-5-5");
    // prices come from the price table, so the list shows what each costs
    expect(planner.rows[0].price?.price_out).toBe(10);
  });

  it("rates local models by size, skips embeddings and unsized tags, and lists free ones first", () => {
    const models = ["qwen3:4b", "qwen3:8b", "qwen3-coder:30b", "gpt-oss:120b-cloud", "glm-4.6:cloud", "bge-m3", "llama3:latest"];
    const review = advise(db, { kind: "ollama", models, role: "reviewer" });
    expect(names(review)).toEqual(["qwen3-coder:30b", "glm-4.6:cloud", "gpt-oss:120b-cloud"]);
    expect(review.rows[0].free).toBe(true);
    expect(review.rows[1].cloud).toBe(true);
    expect(review.limited).toBe(false);
  });

  it("when nothing is good, lists the least bad as limited; and nothing for a planner that is too small", () => {
    const small = advise(db, { kind: "ollama", models: ["qwen3:4b"], role: "worker", work: "small" });
    expect(small.limited).toBe(true);
    expect(names(small)).toEqual(["qwen3:4b"]);
    expect(advise(db, { kind: "ollama", models: ["qwen3:4b"], role: "planner" }).rows).toEqual([]);
  });

  it("guesses other providers' models from the name, and says nothing about unknown ones on Ollama", () => {
    expect(classify("gpt-x-mini", "openai")!.id).toBe("generic-small");
    expect(classify("llama-3.1-8b-instruct", "openai")!.id).toBe("small-local");
    expect(classify("somemodel", "ollama")).toBeUndefined();
  });

  it("reads a developer's work type from the Specialty line", () => {
    expect(guessWork("Specialty: frontend (HTML, CSS, React, accessibility)\n\nbody")).toBe("ui");
    expect(guessWork("Specialty: documentation (README, AGENTS.md, guides)")).toBe("docs");
    expect(guessWork("Specialty: website and landing page copy")).toBe("docs");
    expect(guessWork("Specialty: Efecte ITSM (Jython 2.2 scripts, XSLT 1.0, XML 1.0)")).toBe("backend");
    expect(guessWork("You are a developer on the team.")).toBe("backend");
  });

  it("serves the guide with prices and your own run history", async () => {
    const { buildApp } = await import("../src/index.ts");
    const { app } = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-guide-app-")) });
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const res = await app.inject({ method: "GET", url: "/api/model-guide", headers: { cookie, host: "localhost" } });
    const g = res.json();
    expect(g.work).toHaveLength(6);
    expect(g.models.find((m: any) => m.id === "sonnet").price.price_in).toBe(2);
    expect(g.models.some((m: any) => m.id === "embedding")).toBe(false);
    expect(Array.isArray(g.history)).toBe(true);
    await app.close();
  });
});
