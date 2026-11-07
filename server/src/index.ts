import "./quiet.ts";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import { Vault } from "./crypto.ts";
import { registerAuth } from "./auth.ts";
import { registerRoutes } from "./routes.ts";
import { registerUsage } from "./usage.ts";
import { registerAttachments } from "./attachments.ts";
import { registerTeams } from "./teams.ts";
import { registerModelGuide } from "./modelGuide.ts";
import { Scrum, registerScrum } from "./scrum.ts";
import { registerBudget } from "./budget.ts";
import { Orchestrator } from "./orchestrator/orchestrator.ts";

const here = dirname(fileURLToPath(import.meta.url));

export type AppOptions = { dataDir: string; webDist?: string; logger?: boolean };

export async function buildApp(opts: AppOptions) {
  const db = openDb(join(opts.dataDir, "agentdesk.db"));
  const vault = new Vault(join(opts.dataDir, "master.key"));
  const orch = new Orchestrator(db, vault, opts.dataDir);
  orch.scrum = new Scrum(db, orch);

  const app = Fastify({ logger: opts.logger ? { level: "info" } : false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cookie);

  // Local tool: refuse requests that do not come from this machine's own UI (DNS rebinding, other sites).
  app.addHook("onRequest", async (req, reply) => {
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return reply.code(403).send({ error: "Local access only" });
    const origin = req.headers.origin;
    if (origin && req.method !== "GET" && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      return reply.code(403).send({ error: "Cross-site request refused" });
    }
  });

  registerAuth(app, db);
  registerRoutes(app, db, vault, orch, opts.dataDir);
  registerUsage(app, db);
  registerAttachments(app, db, opts.dataDir);
  registerTeams(app, db);
  registerModelGuide(app, db);
  registerScrum(app, db, orch.scrum);
  registerBudget(app, db);

  if (opts.webDist && existsSync(opts.webDist)) {
    // wildcard (default): files are looked up per request, so a rebuilt UI is served without a restart.
    await app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => { orch.stop(); db.close(); });
  return { app, db, vault, orch };
}

async function main() {
  // --demo: scripted agents, no model calls, separate data folder. For trying the app and the office.
  const demo = process.argv.includes("--demo") || process.env.AGENTDESK_DEMO === "1";
  if (demo) process.env.AGENTDESK_DEMO = "1";
  const dataDir = resolve(process.env.AGENTDESK_DATA ?? join(here, "..", "..", demo ? "data-demo" : "data"));
  const port = Number(process.env.PORT ?? 4317);
  const { app, orch } = await buildApp({ dataDir, webDist: join(here, "..", "..", "web", "dist"), logger: process.env.LOG === "1" });
  orch.start();
  // Bound to the loopback interface only: the tool never listens on the network.
  await app.listen({ host: "127.0.0.1", port });
  console.log(`AgentDesk running at http://localhost:${port}  (data: ${dataDir})${demo ? "  DEMO MODE: no model calls" : ""}`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
