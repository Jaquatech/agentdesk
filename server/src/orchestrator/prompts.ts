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
      wiki: {
        type: "array",
        description: "Project wiki pages to write. Never a General page, and never a project name, dataset, or customer name that would belong on a General page.",
        items: {
          type: "object",
          required: ["title", "section", "body"],
          properties: {
            title: { type: "string" },
            section: { type: "string", enum: ["overview", "architecture", "roadmap", "setup", "decisions", "releases"] },
            body: { type: "string", description: "Markdown. overview, architecture, roadmap and setup replace that page. decisions and releases are one page each, matched by title." },
          },
        },
      },
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
  No diffs, no logs, no secrets. It is also copied onto this task's wiki page.
- The project's wiki is in your instructions. Use write_wiki when you learn something that belongs on a project page. Do not write this project's name, its data, or a customer name into a General page.`;
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

Finish with your verdict: approve, or changes with concrete fix instructions.`;
}

export const NOTES_TOOL: ToolDef = {
  name: "submit_notes",
  description: "the project notes",
  input_schema: { type: "object", required: ["notes"], properties: { notes: { type: "string", description: "Markdown" } } },
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
Single-task reviews already covered style and correctness; focus on what is dangerous. Verdict "issues" only for real findings.`;
}
