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
import { registerDataFactory } from "./dataFactory/routes.ts";
import { registerUsage } from "./usage.ts";
import { registerAttachments } from "./attachments.ts";
import { registerTeams } from "./teams.ts";
import { registerModelGuide } from "./modelGuide.ts";
import { Scrum, registerScrum } from "./scrum.ts";
import { registerBudget } from "./budget.ts";
import { SECURITY_HEADERS } from "./securityHeaders.ts";
import { Orchestrator } from "./orchestrator/orchestrator.ts";
import { seedDemo } from "./demoSeed.ts";

const here = dirname(fileURLToPath(import.meta.url));

export type AppOptions = { dataDir: string; webDist?: string; logger?: boolean; port?: number; allowedOrigins?: string[] };

export async function buildApp(opts: AppOptions) {
  const db = openDb(join(opts.dataDir, "agentdesk.db"));
  const vault = new Vault(join(opts.dataDir, "master.key"));
  const orch = new Orchestrator(db, vault, opts.dataDir);
  orch.scrum = new Scrum(db, orch);

  const app = Fastify({ logger: opts.logger ? { level: "info" } : false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cookie);

  const port = opts.port ?? 4317;
  const allowed = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  if (process.env.AGENTDESK_DEV === "1" || process.argv.includes("--dev")) {
    allowed.add("http://localhost:5173");
    allowed.add("http://127.0.0.1:5173");
  }
  for (const o of opts.allowedOrigins ?? []) allowed.add(o);

  // Local tool: refuse requests that do not come from this machine's own UI (DNS rebinding, other sites).
  // Same origin only: other ports on localhost are other apps (and count as the same site for cookies).
  app.addHook("onRequest", async (req, reply) => {
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return reply.code(403).send({ error: "Local access only" });
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    const fetchSite = req.headers["sec-fetch-site"];
    const refused = origin
      ? !allowed.has(origin)
      : fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none";
    if (refused) return reply.code(403).send({ error: "Cross-site request refused" });
  });

  app.addHook("onRequest", async (_req, reply) => { reply.headers(SECURITY_HEADERS); });

  registerAuth(app, db);
  registerRoutes(app, db, vault, orch, opts.dataDir);
  registerDataFactory(app, db, opts.dataDir, vault);
  registerUsage(app, db);
  registerAttachments(app, db, opts.dataDir, (chatId, name, bytes) => orch.readScan(chatId, name, bytes));
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
  const { app, orch, db } = await buildApp({ dataDir, webDist: join(here, "..", "..", "web", "dist"), logger: process.env.LOG === "1", port });
  if (demo) seedDemo(db, dataDir);
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
