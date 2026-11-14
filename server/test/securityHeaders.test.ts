import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index.ts";

describe("security headers", () => {
  it("sends a strict policy on pages and API answers", async () => {
    const webDist = mkdtempSync(join(tmpdir(), "ad-web-"));
    writeFileSync(join(webDist, "index.html"), "<!doctype html><title>x</title>");
    const ctx = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-sec-")), webDist });
    for (const url of ["/", "/api/auth/status"]) {
      const res = await ctx.app.inject({ method: "GET", url, headers: { host: "localhost" } });
      expect(res.headers["content-security-policy"], url).toMatch(/script-src 'self'(;|$)/);
      expect(res.headers["content-security-policy"], url).toContain("frame-ancestors 'none'");
      expect(res.headers["content-security-policy"], url).toContain("connect-src 'self'");
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      expect(res.headers["referrer-policy"], url).toBe("no-referrer");
    }
    await ctx.app.close();
  });

  it("refuses other hosts before any page is served", async () => {
    const ctx = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), "ad-sec-")) });
    const res = await ctx.app.inject({ method: "GET", url: "/api/auth/status", headers: { host: "evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-security-policy"]).toBeUndefined();
    await ctx.app.close();
  });
});
