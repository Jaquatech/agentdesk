import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROLLUP_MARKER } from "../chatHistory.ts";
import type { Engine, EngineRequest, EngineResult, TranscriptEntry } from "./types.ts";

/**
 * Scripted engine for trying the app without spending tokens (AGENTDESK_DEMO=1).
 * The planner proposes two small tasks, developers "work" for a while and write a note file,
 * the reviewer asks for one fix round on the first task and approves the rest.
 */
/** Overview text the live sprint task writes. Exported so a test can match the page without running the waits. */
export const DEMO_OVERVIEW = `Red Dust Gadgets builds small gadgets for a Mars crew. This page was updated by the developer working on the airlock dust alarm.

## Goals
- A pocket vacuum that keeps dust out of the airlock
- Hot chocolate that stays in the cup in low gravity
- Playlists chosen by crater

## Now
The airlock dust alarm is in the current sprint: a threshold you can set, and a note on how to test it.
`;

/** Names and text the product manager was given, so a demo reply can quote an attached file. */
function attachedSentence(req: EngineRequest): string {
  const att = req.attachments;
  if (!att || (!att.texts.length && !att.images.length && !att.skipped.length)) return "";
  const parts = [
    ...att.texts.map((t) => `${t.name}: ${t.content.replace(/\s+/g, " ").trim().slice(0, 180)}`),
    ...att.images.map((i) => i.name),
    ...att.skipped,
  ];
  return ` Attached: ${parts.join("; ")}.`;
}

/** The queued task of the active demo sprint. Other scripted tasks do not write the wiki. */
export function demoLiveWiki(prompt: string): { title: string; section: string; body: string } | undefined {
  if (!prompt.startsWith("# Task:") || prompt.includes("# Round") || !prompt.includes("Dust Buddy: airlock dust alarm")) return undefined;
  return { title: "Overview", section: "overview", body: DEMO_OVERVIEW };
}

/**
 * "read attachment notes.txt part 2" fetches that part with the same tool a real model would call.
 * A normal demo reply does not take this path.
 */
function lookupAttachment(req: EngineRequest, step: (e: Omit<TranscriptEntry, "t">) => void): string | undefined {
  if (!req.readAttachment) return undefined;
  const ask = latestAsk(req.prompt);
  const m = /\bread attachment\s+(.+?)(?:\s+part\s+(\d+))?\s*$/i.exec(ask);
  if (!m) return undefined;
  const name = m[1].trim();
  const part = Number(m[2] || 1);
  const output = req.readAttachment(name, part);
  step({ kind: "tool", tool: "read_attachment", input: { name, part }, output });
  req.onActivity?.("reading", name);
  return output;
}

/** The latest user line, from a free chat (`## User`) or a Scrum chat (`## Business owner`). */
function latestAsk(prompt: string): string {
  return ([...prompt.matchAll(/## (?:User|Business owner)\n([^\n]*)/g)].at(-1)?.[1] ?? "").trim();
}

/**
 * A question about an old decision is not in the history window. The scripted planner looks it up
 * with the same tools a real model would call, and quotes the page.
 */
function lookupWiki(req: EngineRequest, step: (e: Omit<TranscriptEntry, "t">) => void): string | undefined {
  if (!req.readWiki) return undefined;
  const ask = latestAsk(req.prompt);
  if (!/\b(decide|decision|wiki|look up|lookup)\b/i.test(ask)) return undefined;
  const query = ask.slice(0, 160);
  const found = req.searchWiki?.(query) ?? "";
  const page = req.readWiki({ section: "decisions" });
  step({ kind: "tool", tool: "search_wiki", input: { query }, output: found });
  step({ kind: "tool", tool: "read_wiki", input: { section: "decisions" }, output: page });
  req.onActivity?.("reading", "wiki");
  return `From the wiki:\n\n${page}`;
}

export class DemoEngine implements Engine {
  private reviews = new Map<string, number>();

  async run(req: EngineRequest): Promise<EngineResult> {
    const t0 = Date.now();
    const wait = (ms: number) => new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      req.signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Stopped")); }, { once: true });
    });
    const transcript: TranscriptEntry[] = [];
    const step = (e: Omit<TranscriptEntry, "t">) => { const x = { t: Date.now() - t0, ...e }; transcript.push(x); req.onStep?.(x); };
    step({ kind: "instructions", text: req.system });
    step({ kind: "prompt", text: req.prompt });
    const result = (summary: string, output?: Record<string, unknown>): EngineResult => ({
      transcript,
      ok: true, summary, output, turns: 6, costUsd: 0, tokensIn: 4_000, cacheRead: 36_000, cacheWrite: 2_000, tokensOut: 1_800, seconds: Math.round((Date.now() - t0) / 1000),
    });
    try {
      if (req.prompt.startsWith(ROLLUP_MARKER)) {
        return result("Kept the decisions from the messages that left the window.\nNames and outcomes are in this note.\nThe recent messages stay in the chat.");
      }
      if (req.output?.name === "submit_backlog") {
        const looked = lookupAttachment(req, step) ?? lookupWiki(req, step);
        if (looked) return result("backlog", { reply: looked, items: [] });
        req.onActivity?.("thinking", "reading the request");
        await wait(1100);
        if (req.prompt.startsWith("# Write one backlog item")) {
          const title = /Title so far: ([^\n]*)/.exec(req.prompt)?.[1] ?? "the request";
          return result("item", { reply: "", items: [{ title, story: `As a business owner I want ${title.toLowerCase()} so that the team can use it.`, acceptance: "- [ ] It works as described\n- [ ] It is covered by a check" }] });
        }
        const ask = ([...req.prompt.split("# Scrum state")[0].matchAll(/## Business owner\n([^\n]*)/g)].at(-1)?.[1] ?? "the request").trim();
        if (/\breview\b/i.test(ask)) return result("review", { reply: "Backlog review (demo): items look separable. Put the one that unblocks others first.", items: [] });
        const out: Record<string, unknown> = { reply: `Noted (demo product manager): _${ask}_.${attachedSentence(req)} I added it to the backlog; the architect and a developer refine it next.`, items: [] };
        if (/\bpi\b/i.test(ask) && /create|new|start/i.test(ask)) out.pi = { name: "PI 1", goal: ask.slice(0, 120) };
        else if (/\bsprint\b/i.test(ask) && /create|new|plan/i.test(ask)) out.sprint = { name: "Sprint " + ask.slice(0, 30), goal: ask.slice(0, 120) };
        else out.items = [{ title: ask.slice(0, 60), story: `As a business owner I want: ${ask}`, acceptance: "- [ ] Works as described\n- [ ] Has a check" }];
        return result("backlog", out);
      }
      if (req.output?.name === "submit_architecture") {
        for (const f of ["README.md", "src/"]) { req.onActivity?.("reading", `read ${f}`); await wait(700); }
        return result("architecture", { tech_notes: "## Approach (demo)\nAdd one small file under `demo/`.\n## Tests\nThe file exists.\n## Out of scope\nEverything else.", paths: ["demo/"] });
      }
      if (req.output?.name === "submit_estimate") {
        req.onActivity?.("thinking", "sizing the work");
        await wait(900);
        return result("estimate", { points: 3, reason: "A normal small change (demo)." });
      }
      if (req.output?.name === "submit_security_review") {
        for (const f of ["git diff", "demo/"]) { req.onActivity?.("reviewing", f); await wait(1200); }
        return result("security", { verdict: "pass", report: "## Security review (demo)\nChecked the diff for secrets, injection and unsafe file access. Nothing found." });
      }
      if (req.output?.name === "submit_notes" && req.prompt.includes("release notes of sprint")) {
        await wait(900);
        const names = [...req.prompt.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
        return result("notes", { notes: `## Release notes (demo)\nThis sprint delivered ${names.length} item${names.length === 1 ? "" : "s"}.\n\n${names.map((n) => `- ${n}`).join("\n")}` });
      }
      if (req.output?.name === "submit_notes") {
        for (const f of ["README.md", "package.json", "src/"]) { req.onActivity?.("reading", `read ${f}`); await wait(700); }
        return result("notes", { notes: "## Demo notes\nWritten by the demo engine. Run without `--demo` and the planner reads the repository and writes real notes here." });
      }
      if (req.agent.role === "planner" && /## User\n[^\n]*\bmerge\b[^\n]*\s*$/i.test(req.prompt.split("# Team")[0].trimEnd())) {
        req.onActivity?.("thinking", "checking finished tasks");
        await wait(1000);
        const approved = (/Approved tasks: ([^\n.]*)/.exec(req.prompt)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "none");
        return result("plan", {
          reply: approved.length ? `Ready to merge: ${approved.join(", ")}. Press **Merge** below.` : "Nothing is approved yet, so there is nothing to merge.",
          tasks: [], merge: approved,
        });
      }
      if (req.agent.role === "planner" && /## User\n[^\n]*\b(again|retry)\b[^\n]*\s*$/i.test(req.prompt.split("# Team")[0].trimEnd())) {
        req.onActivity?.("thinking", "checking earlier tasks");
        await wait(1000);
        const slugs = (/Retryable: ([^\n.]*)/.exec(req.prompt)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "none");
        return result("plan", {
          reply: slugs.length ? `Ready to run again: ${slugs.join(", ")}.` : "Nothing has failed, so there is nothing to run again.",
          tasks: [], retry: slugs.map((slug) => ({ slug })), journal: slugs.length ? [`Asked to re-run ${slugs.join(", ")}.`] : [],
        });
      }
      if (req.agent.role === "planner") {
        const looked = lookupAttachment(req, step) ?? lookupWiki(req, step);
        if (looked) return result("plan", { reply: looked, tasks: [] });
        for (const f of ["README.md", "src/", "package.json"]) { req.onActivity?.("reading", `read ${f}`); await wait(900); }
        req.onActivity?.("thinking", "splitting the work");
        await wait(1200);
        const ask = /# Conversation[\s\S]*## User\n([^\n]*)/.exec(req.prompt)?.[1] ?? "the request";
        return result("plan", {
          reply: `Demo plan for: _${ask}_.${attachedSentence(req)} Two small tasks; each runs in its own branch and goes through checks and review.`,
          tasks: [
            { slug: "demo-notes", title: "Write the design notes", spec: "## Goal\nAdd `demo/notes.md` describing the change.\n## Tests\nFile exists.", paths: ["demo/"] },
            { slug: "demo-changelog", title: "Add a changelog entry", spec: "## Goal\nAdd `demo/changelog.md`.\n## Tests\nFile exists.", paths: ["demo/"] },
          ],
        });
      }
      if (req.agent.role === "reviewer") {
        for (const f of ["git diff", "demo/notes.md"]) { req.onActivity?.("reviewing", f); await wait(1500); }
        const key = req.prompt.split("\n")[0];
        const n = (this.reviews.get(key) ?? 0) + 1;
        this.reviews.set(key, n);
        if (n === 1 && key.includes("design notes")) {
          return result("review", { verdict: "changes", review: "Good start. The notes miss a short **Risks** section.", fixes: ["Add a `## Risks` section to demo/notes.md"] });
        }
        return result("review", { verdict: "approve", review: "Clear and small. Matches the spec." });
      }
      const steps: [Parameters<NonNullable<EngineRequest["onActivity"]>>[0], string][] = [
        ["reading", "read README.md"], ["thinking", "planning the change"], ["typing", "edit demo/notes.md"],
        ["typing", "edit demo/notes.md"], ["running", "npm test"], ["reading", "read test output"],
      ];
      step({ kind: "model", text: "I'll look at the README first, then write the file the task asks for.", ms: 900, tokens: { in: 4200, out: 60, cacheRead: 0 } });
      for (const [s, d] of steps) {
        req.onActivity?.(s, d); req.onLog?.(`→ ${d}`);
        const started = Date.now();
        await wait(1800 + Math.random() * 1500);
        const [verb, ...rest] = d.split(" ");
        const tool = verb === "read" ? "read_file" : verb === "edit" ? "edit_file" : s === "running" ? "run_command" : "";
        if (tool) step({ kind: "tool", tool, input: tool === "run_command" ? { command: d } : { path: rest.join(" ") },
          output: tool === "read_file" ? "1\t# Sample app" : tool === "run_command" ? "exit 0\nall tests passed (demo)" : `Edited ${rest.join(" ")}`, ms: Date.now() - started });
        else step({ kind: "model", text: "Planning the change: one new file under demo/.", ms: Date.now() - started, tokens: { in: 4800, out: 40, cacheRead: 4100 } });
      }
      // Show the approval flow: one command outside the default list (first round only).
      if (req.askApproval && !req.prompt.includes("# Round")) {
        const command = "npm install --no-audit --no-fund left-pad";
        step({ kind: "note", text: `Asked you to allow: ${command}` });
        const answer = await req.askApproval({ kind: "command", command, cwd: req.cwd });
        step({ kind: "note", text: `${answer.allowed ? "Allowed" : "Denied"} by ${answer.by ?? "user"}: ${command}` });
        if (answer.allowed) step({ kind: "tool", tool: "run_command", input: { command }, output: "exit 0\nadded 1 package (demo: nothing was installed)" });
      }
      const slug = /branch `task\/([^`]+)`/.exec(req.prompt)?.[1] ?? "demo";
      mkdirSync(join(req.cwd, "demo"), { recursive: true });
      const fix = req.prompt.includes("# Round");
      writeFileSync(join(req.cwd, "demo", slug === "demo-notes" ? "notes.md" : slug === "demo-changelog" ? "changelog.md" : `${slug}.md`),
        `# ${slug}\n\nWritten by the demo engine at ${new Date().toISOString()}.\n${fix ? "\n## Risks\nNone; demo only.\n" : ""}`);
      // The active sprint's live task (Dust Buddy, queued, runs on its own) updates Overview once.
      const wiki = demoLiveWiki(req.prompt);
      if (wiki && req.writeWiki) {
        const output = req.writeWiki(wiki);
        step({ kind: "tool", tool: "write_wiki", input: wiki, output });
        req.onActivity?.("typing", "wiki Overview");
        req.onLog?.("→ wiki Overview");
      }
      return result(fix ? "- Added the Risks section" : "- Added the file\n- Tests: none needed (demo)");
    } catch (err) {
      return { ...result(""), ok: false, error: String((err as Error).message) };
    }
  }
}
