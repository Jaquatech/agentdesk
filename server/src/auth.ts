import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "./db.ts";
import { hashPassword, verifyPassword, newToken, sha256 } from "./crypto.ts";

const COOKIE = "agentdesk_session";
const SESSION_DAYS = 14;

declare module "fastify" {
  interface FastifyRequest { userId?: number }
}

export function registerAuth(app: FastifyInstance, db: DB) {
  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

  const startSession = (reply: FastifyReply, userId: number) => {
    const token = newToken();
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
      .run(sha256(token), userId, `+${SESSION_DAYS} days`);
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: SESSION_DAYS * 86400 });
  };

  app.get("/api/auth/status", async (req) => {
    const user = currentUser(db, req);
    return { needsSetup: userCount() === 0, user, demo: process.env.AGENTDESK_DEMO === "1" };
  });

  // First start: the first account is created from the UI. Later accounts need a signed-in user.
  app.post("/api/auth/setup", async (req, reply) => {
    if (userCount() > 0) return reply.code(409).send({ error: "Already set up" });
    const { username, password } = req.body as { username?: string; password?: string };
    const err = checkCredentials(username, password);
    if (err) return reply.code(400).send({ error: err });
    const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username!.trim(), hashPassword(password!));
    startSession(reply, Number(info.lastInsertRowid));
    return { ok: true };
  });

  // Lockout: 5 wrong passwords within 10 minutes pause sign-in for 5 minutes (kept in memory, so a restart clears it).
  const fails: number[] = [];
  let lockedUntil = 0;
  const MAX_FAILS = 5, WINDOW_MS = 10 * 60_000, LOCK_MS = 5 * 60_000;

  app.post("/api/auth/login", async (req, reply) => {
    const now = Date.now();
    if (now < lockedUntil) {
      return reply.code(429).send({ error: `Too many wrong passwords. Try again in ${Math.ceil((lockedUntil - now) / 60_000)} min.` });
    }
    const { username, password } = req.body as { username?: string; password?: string };
    const row = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(String(username ?? "").trim()) as
      { id: number; password_hash: string } | undefined;
    if (!row || !verifyPassword(String(password ?? ""), row.password_hash)) {
      await new Promise((r) => setTimeout(r, 400));
      fails.push(Date.now());
      while (fails.length && fails[0] < Date.now() - WINDOW_MS) fails.shift();
      if (fails.length >= MAX_FAILS) { lockedUntil = Date.now() + LOCK_MS; fails.length = 0; }
      return reply.code(401).send({ error: "Wrong username or password" });
    }
    fails.length = 0;
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    startSession(reply, row.id);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/users", async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    const err = checkCredentials(username, password);
    if (err) return reply.code(400).send({ error: err });
    try {
      db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username!.trim(), hashPassword(password!));
    } catch {
      return reply.code(409).send({ error: "Username taken" });
    }
    return { ok: true };
  });

  app.post("/api/users/me/password", async (req, reply) => {
    const { current, password } = req.body as { current?: string; password?: string };
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.userId) as { password_hash: string };
    if (!verifyPassword(String(current ?? ""), row.password_hash)) return reply.code(400).send({ error: "Current password is wrong" });
    if (!password || password.length < 8) return reply.code(400).send({ error: "Use at least 8 characters" });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), req.userId);
    return { ok: true };
  });

  // Everything else under /api needs a session.
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/") || req.url.startsWith("/api/auth/")) return;
    const user = currentUser(db, req);
    if (!user) return reply.code(401).send({ error: "Sign in first" });
    req.userId = user.id;
  });
}

function currentUser(db: DB, req: FastifyRequest) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  return (db.prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(sha256(token)) as { id: number; username: string } | undefined) ?? null;
}

function checkCredentials(username?: string, password?: string) {
  if (!username || !/^[\w.@-]{2,40}$/.test(username.trim())) return "Username: 2–40 letters, digits, . _ - @";
  if (!password || password.length < 8) return "Password: at least 8 characters";
  return null;
}
