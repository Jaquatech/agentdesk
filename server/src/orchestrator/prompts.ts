import type { ToolDef } from "../providers/types.ts";

/** Default starting contexts for new agents (editable per agent in the UI). */
export const ROLE_TEMPLATES = {
  planner: `You are the architect of a small AI development team. You read the code and the request, then either
answer directly or split the work into precise tasks for cheaper developer agents.

How to write tasks:
- One task = one branch and one pull request. Prefer 1–4 tasks; split only where the work touches different files.
- A developer model implements exactly what you write. Name files, functions, ids, inputs and test cases.
- Say which tests prove the task and what is out of scope.
- Give each task the folders/files it may change (paths). Changes outside them are rejected.`,
  worker: `You are a developer on the team. The architect wrote the task below; you implement it.

Working style:
- Small, readable changes that match the surrounding code. No new packages unless the task says so.
- Run the targeted tests for what you changed until they pass. Read files by line range; keep command output quiet.
- Secrets and personal data are never printed, logged or committed.
- No git writes: leave changes in the working tree; the team tool commits, pushes and opens the PR.
- If something is unclear, take the most reasonable reading, do it, and say so in your final message.`,
  reviewer: `You are the code reviewer (QA). A developer agent built this branch from the architect's spec. You review it
before the final human look. You do not change files.

Check: does it do what the spec says, are there tests for it, is anything risky (security, data loss, secrets in
logs), does it match the surrounding code. Ignore style nits a formatter would fix. Approve when it is good enough
to merge; ask for changes only for real problems, as concrete fix instructions.`,
};

/** One sentence every role sees: which project wiki pages it may change. General pages stay out. */
export const WIKI_LINE = "You may update this project's wiki pages: overview, architecture, roadmap (Road map), setup, decisions and releases. Update Overview, Architecture, Road map and Setup when your work changes them. Never a General page.";

/** Sentences that ask for page updates. Kept as constants so `withoutWikiWrites` can take them out when the project wiki is off. */
export const WIKI_CALL = " Call write_wiki, or include the pages in `wiki`.";
export const WIKI_PUT = " Put page updates in `wiki`.";
export const WORKER_WIKI_BULLET = "\n- The wiki in your instructions is an index. Overview, Architecture and Setup are written out for you, except on the Claude CLI, which includes Overview only. Use read_wiki or search_wiki when they are available. Use write_wiki for overview, architecture, roadmap (Road map), setup, decisions and releases when your work changes them. Update Overview, Architecture, Road map and Setup when they are no longer true. A title is optional for those four; decisions and releases are one page per title. Do not write this project's name, its data, or a customer name into a General page.";
export const PLAN_WIKI_LINES = `\n${WIKI_LINE} The wiki in your instructions is an index. Use read_wiki or search_wiki when you need a page that is not written out. Put the pages in \`wiki\`: overview, architecture, roadmap and setup replace that one page (a title is optional). decisions and releases are one page per title.
Do not put this project's name, its data, or a customer name into General pages. You cannot edit those from here.`;

/** A prompt without the sentences that ask to update project wiki pages. Pure; used when a project's wiki switch is off. */
export function withoutWikiWrites(prompt: string): string {
  return [WORKER_WIKI_BULLET, PLAN_WIKI_LINES, WIKI_CALL, WIKI_PUT, `${WIKI_LINE} `, WIKI_LINE]
    .reduce((text, part) => text.split(part).join(""), prompt)
    .trimEnd();
}

/** A copy of an output tool without its `wiki` property. The shared tool constants are not changed. */
export function withoutWikiField(tool: ToolDef): ToolDef {
  const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] };
  if (!schema.properties || !("wiki" in schema.properties)) return tool;
  const properties = { ...schema.properties };
  delete properties.wiki;
  return { ...tool, input_schema: { ...schema, properties, ...(schema.required ? { required: schema.required.filter((r) => r !== "wiki") } : {}) } };
}

const WIKI_ITEM = {
  type: "object",
  required: ["section", "body"],
  properties: {
    title: { type: "string", description: "Optional for overview, architecture, roadmap and setup. Required for decisions and releases." },
    section: { type: "string", description: "overview, architecture, roadmap, setup, decisions, or releases. Road map, road-map and Overview.md are accepted." },
    body: { type: "string", description: "Markdown for the whole page." },
  },
};

export const WIKI_FIELD = {
  type: "array",
  description: "Project wiki pages to update when this work changes them. Sections: overview, architecture, roadmap (Road map), setup, decisions, releases. Update Overview, Architecture, Road map and Setup when they are no longer true. Those four replace that one page; decisions and releases are one page per title. Never a General page, and never a project name, dataset, or customer name that would belong on a General page.",
  items: WIKI_ITEM,
};

export const IMAGE_NOTES_FIELD = {
  type: "array",
  description: "One short line per image the user attached in this message: what matters in it (text, numbers, error messages, layout). Only for images you were shown.",
  items: {
    type: "object",
    required: ["name", "note"],
    properties: {
      name: { type: "string", description: "the image's file name, as listed under Attached by the user" },
      note: { type: "string", description: "one short line" },
    },
  },
};

export const PLAN_TOOL: ToolDef = {
  name: "submit_plan",
  description: "your answer to the user and the tasks to run (tasks may be empty when no code change is needed)",
  input_schema: {
    type: "object",
    required: ["reply", "tasks"],
    properties: {
      reply: { type: "string", description: "Markdown answer shown in the chat: what you found and what the tasks do." },
      tasks: {
        type: "array",
        items: {
          type: "object",
          required: ["slug", "title", "spec"],
          properties: {
            slug: { type: "string", description: "short-kebab-id, unique in this chat" },
            title: { type: "string" },
            spec: { type: "string", description: "Markdown: Goal, Behaviour, Tests, Out of scope" },
            paths: { type: "array", items: { type: "string" }, description: "folders/files the task may change; folders end with /" },
            worker: { type: "string", description: "name of the developer agent to use (optional)" },
          },
        },
      },
      merge: { type: "array", items: { type: "string" }, description: "slugs of approved tasks the user asked to merge" },
      retry: {
        type: "array",
        description: "earlier tasks (any chat of this project) the user asked to run again; optionally with another developer",
        items: { type: "object", required: ["slug"], properties: { slug: { type: "string" }, worker: { type: "string" } } },
      },
      journal: {
        type: "array", items: { type: "string" },
        description: "0-3 short notes for later chats in this project: decisions, findings, state (not a summary of this reply)",
      },
      wiki: WIKI_FIELD,
      image_notes: IMAGE_NOTES_FIELD,
    },
  },
};

export const REVIEW_TOOL: ToolDef = {
  name: "submit_review",
  description: "your review verdict",
  input_schema: {
    type: "object",
    required: ["verdict", "review"],
    properties: {
      verdict: { type: "string", enum: ["approve", "changes"] },
      review: { type: "string", description: "Markdown, under ~60 lines: findings and accepted trade-offs" },
      fixes: { type: "array", items: { type: "string" }, description: "concrete fix instructions when verdict is changes" },
      wiki: WIKI_FIELD,
    },
  },
};

export function buildWorkerPrompt(o: {
  title: string; spec: string; branch: string; round: number; feedback?: string; paths: string[]; verify: string[];
  /** The project gives its checks an env file that agents do not get: they must not look for or recreate it. */
  envForChecks?: boolean;
}) {
  const round = o.round > 0 && o.feedback
    ? `\n\n# Round ${o.round + 1}: fix\nThis branch already holds the earlier rounds of this task. Make these changes on top of them; keep everything else.\n\n${o.feedback}\n\nIn your final message, list only what changed in this round.`
    : "";
  return `# Task: ${o.title}

${o.spec}${round}

# How to finish
- You are in a git worktree on branch \`${o.branch}\`. Work only inside this folder.
- ${o.paths.length ? `Change only these paths: ${o.paths.join(", ")}.` : "Keep changes to what the task needs."}
- ${o.verify.length ? `After you finish, the team tool runs: ${o.verify.join(" ; ")}. ${o.envForChecks
    ? "These need settings that only the team tool has: do not run them yourself, do not look for .env files and do not create one; a failure about missing settings is not yours to fix."
    : "Run the relevant ones yourself first."}` : "Run the relevant tests yourself."}
- Do not commit, push or open a PR; leave changes in the working tree.
- Your final message becomes the PR description: what changed (short bullets), tests run and results, anything left open.
  No diffs, no logs, no secrets. It is also copied onto this task's wiki page.${WORKER_WIKI_BULLET}`;
}

export function buildReviewPrompt(o: { title: string; specs: string; branch: string; base: string; diffStat: string; verify: string[] }) {
  return `# Review: ${o.title}

## Spec (all rounds)
${o.specs}

## Branch
\`${o.branch}\`, compared with \`${o.base}\`. Changed files:
\`\`\`
${o.diffStat}
\`\`\`
Read the diff with \`git diff ${o.base}...HEAD\` (per file if large) and open files for context.
${o.verify.length ? `The verify commands passed: ${o.verify.join(" ; ")}.` : ""}

Finish with your verdict: approve, or changes with concrete fix instructions.
${WIKI_LINE}${WIKI_CALL}`;
}

export const NOTES_TOOL: ToolDef = {
  name: "submit_notes",
  description: "the project notes",
  input_schema: { type: "object", required: ["notes"], properties: { notes: { type: "string", description: "Markdown" }, wiki: WIKI_FIELD } },
};

// ---------- Scrum ----------

export const SCRUM_TOOL: ToolDef = {
  name: "submit_backlog",
  description: "your answer to the business owner and any backlog items, PI or sprint to create",
  input_schema: {
    type: "object",
    required: ["reply", "items"],
    properties: {
      reply: { type: "string", description: "Markdown answer shown in the chat. When you review the backlog, the review goes here." },
      items: {
        type: "array",
        description: "New backlog items for what the business owner asked for. Empty when they only asked a question or for a review.",
        items: {
          type: "object",
          required: ["title", "story", "acceptance"],
          properties: {
            title: { type: "string", description: "short, plain" },
            story: { type: "string", description: "As a <who> I want <what> so that <why>, plus any business context given" },
            acceptance: { type: "string", description: "Markdown checklist of testable acceptance criteria" },
          },
        },
      },
      pi: {
        type: "object", description: "Only when asked to create a PI (program increment): a goal that groups several sprints.",
        properties: { name: { type: "string" }, goal: { type: "string" } },
      },
      sprint: {
        type: "object", description: "Only when asked to create a sprint (it is planned, not started).",
        properties: { name: { type: "string" }, goal: { type: "string" } },
      },
      wiki: WIKI_FIELD,
      image_notes: IMAGE_NOTES_FIELD,
    },
  },
};

export const ARCHITECT_TOOL: ToolDef = {
  name: "submit_architecture",
  description: "the technical notes for one backlog item",
  input_schema: {
    type: "object",
    required: ["tech_notes", "paths"],
    properties: {
      tech_notes: { type: "string", description: "Markdown: approach, files and functions to touch, tests that prove it, risks, what is out of scope. Precise enough for a cheaper developer model." },
      paths: { type: "array", items: { type: "string" }, description: "folders/files the work may change; folders end with /" },
      worker: { type: "string", description: "name of the best-suited developer in the team (optional)" },
      wiki: WIKI_FIELD,
    },
  },
};

export const ESTIMATE_TOOL: ToolDef = {
  name: "submit_estimate",
  description: "your size estimate for one backlog item",
  input_schema: {
    type: "object",
    required: ["points", "reason"],
    properties: {
      points: { type: "integer", enum: [1, 2, 3, 5, 8, 13], description: "relative size: 1 = trivial edit, 3 = a normal change, 8 = a large one, 13 = too big, must be split" },
      reason: { type: "string", description: "one or two sentences" },
      wiki: WIKI_FIELD,
    },
  },
};

export const SECURITY_TOOL: ToolDef = {
  name: "submit_security_review",
  description: "the security review of a whole sprint",
  input_schema: {
    type: "object",
    required: ["verdict", "report"],
    properties: {
      verdict: { type: "string", enum: ["pass", "issues"] },
      report: { type: "string", description: "Markdown, under ~60 lines: what you checked, findings by severity with file and line, what is fine" },
      wiki: WIKI_FIELD,
    },
  },
};

export function buildSecurityPrompt(o: { sprint: string; goal: string; branch: string; base: string; diffStat: string; items: string[] }) {
  return `# Security review: ${o.sprint}
${o.goal ? `Sprint goal: ${o.goal}\n` : ""}
This sprint's work is merged on \`${o.branch}\` and not yet released. Everything it changes compared with \`${o.base}\`:
\`\`\`
${o.diffStat}
\`\`\`
Read the diff with \`git diff ${o.base}...HEAD\` (per file if large) and open files for context.

Delivered items:
${o.items.map((i) => `- ${i}`).join("\n") || "- (none)"}

Look for: secrets or personal data in code or logs, injection (SQL, command, path, HTML), missing authorization or input checks,
unsafe file or network access, dependencies added or loosened, error messages that leak internals, disabled security checks.
Single-task reviews already covered style and correctness; focus on what is dangerous. Verdict "issues" only for real findings.
${WIKI_LINE}${WIKI_CALL}`;
}
