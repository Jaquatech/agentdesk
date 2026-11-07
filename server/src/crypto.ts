import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Secrets are encrypted with AES-256-GCM using a master key that lives outside the database:
 * AGENTDESK_MASTER_KEY (base64, 32 bytes) or a key file created on first start (data/master.key).
 * Copying the database alone never exposes the API keys.
 */
export class Vault {
  private key: Buffer;

  constructor(keyFile: string, envKey = process.env.AGENTDESK_MASTER_KEY) {
    if (envKey) {
      this.key = Buffer.from(envKey, "base64");
    } else if (existsSync(keyFile)) {
      this.key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64");
    } else {
      mkdirSync(dirname(keyFile), { recursive: true });
      this.key = randomBytes(32);
      writeFileSync(keyFile, this.key.toString("base64"), { encoding: "utf8", mode: 0o600 });
      try { chmodSync(keyFile, 0o600); } catch { /* Windows: ACLs of the user profile apply */ }
    }
    if (this.key.length !== 32) throw new Error("Master key must be 32 bytes (base64)");
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
  }

  decrypt(blob: string): string {
    const raw = Buffer.from(blob, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

/** Shows only enough of a secret to recognise it: "sk-…a1b2". */
export function secretHint(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 3)}…${v.slice(-4)}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
