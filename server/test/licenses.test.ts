import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/index.ts";
import { collectPackages, licenseAllowed, licenseProblems, noticesCurrent, renderNotices } from "../src/licenses.ts";

const lock = {
  lockfileVersion: 3,
  packages: {
    "": { name: "root" },
    "node_modules/a": { version: "1.0.0", license: "MIT" },
    "node_modules/@s/b": { version: "2.0.0", license: "ISC" },
    "node_modules/a/node_modules/c": { version: "3.0.0", license: "BSD-3-Clause" },
    "node_modules/t": { version: "4.0.0", license: "MIT", dev: true },
    "node_modules/l": { version: "5.0.0", license: "MIT", link: true },
    "server": { name: "@agentdesk/server", version: "1.0.0" },
    "node_modules/n": { version: "0.1.0" },
  },
};

describe("collectPackages", () => {
  it("keeps dependencies only, handles scopes and nesting, and sorts by name", () => {
    expect(collectPackages(lock)).toEqual([
      { name: "@s/b", version: "2.0.0", license: "ISC" },
      { name: "a", version: "1.0.0", license: "MIT" },
      { name: "c", version: "3.0.0", license: "BSD-3-Clause" },
      { name: "n", version: "0.1.0", license: "" },
    ]);
  });
});

describe("licenseAllowed", () => {
  it("applies OR (any alternative) and AND (all parts)", () => {
    expect(licenseAllowed("MIT")).toBe(true);
    expect(licenseAllowed("(MIT OR GPL-3.0-or-later)")).toBe(true);
    expect(licenseAllowed("Apache-2.0 AND MIT")).toBe(true);
    expect(licenseAllowed("GPL-3.0-only")).toBe(false);
    expect(licenseAllowed("AGPL-3.0-or-later")).toBe(false);
    expect(licenseAllowed("MIT AND GPL-2.0-only")).toBe(false);
    expect(licenseAllowed("")).toBe(false);
    expect(licenseAllowed(undefined)).toBe(false);
  });
});

describe("licenseProblems", () => {
  it("reports a missing licence and a disallowed one with name@version", () => {
    const problems = licenseProblems([
      { name: "n", version: "0.1.0", license: "" },
      { name: "g", version: "9.9.9", license: "GPL-3.0-only" },
      { name: "ok", version: "1.0.0", license: "MIT" },
    ]);
    expect(problems).toEqual([
      "n@0.1.0: no licence field",
      "g@9.9.9: GPL-3.0-only is not on the allow-list",
    ]);
  });
});

describe("renderNotices and noticesCurrent", () => {
  const pkgs = collectPackages(lock);
  const md = renderNotices(pkgs, "Copyright (c) 2026 Example");

  it("contains the own copyright, a count line and every package row", () => {
    expect(md).toContain("# Third-party notices");
    expect(md).toContain("Copyright (c) 2026 Example");
    expect(md).toContain("- MIT: 1");
    expect(md).toContain("| @s/b | 2.0.0 | ISC |");
    expect(md).toContain("| c | 3.0.0 | BSD-3-Clause |");
  });

  it("is current for its own output and stale after a row is removed", () => {
    expect(noticesCurrent(pkgs, md)).toBe(true);
    const without = md.split("\n").filter((l) => !l.startsWith("| c | 3.0.0 |")).join("\n");
    expect(noticesCurrent(pkgs, without)).toBe(false);
  });
});

describe("the real repository", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pkgs = collectPackages(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")));

  it("has no licence problems", () => {
    expect(licenseProblems(pkgs)).toEqual([]);
  });

  it("has a current THIRD_PARTY_NOTICES.md", () => {
    expect(noticesCurrent(pkgs, readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8"))).toBe(true);
  });
});

describe("GET /api/licenses", () => {
  let data: string;
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;

  beforeAll(async () => {
    data = mkdtempSync(join(tmpdir(), "ad-licenses-"));
    ctx = await buildApp({ dataDir: data });
    const setup = await ctx.app.inject({ method: "POST", url: "/api/auth/setup", headers: { host: "localhost" }, payload: { username: "jan", password: "password123" } });
    cookie = String(setup.headers["set-cookie"]).split(";")[0];
  });

  afterAll(async () => {
    await ctx.app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("returns the package list and the licence counts", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/api/licenses", headers: { cookie, host: "localhost" } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.packages.length).toBeGreaterThanOrEqual(100);
    expect(body.licenses.MIT).toBeGreaterThan(0);
  });
});

it("allows Zlib (permissive, used by pako as MIT AND Zlib)", () => {
  expect(licenseAllowed("Zlib")).toBe(true);
  expect(licenseAllowed("MIT AND Zlib")).toBe(true);
});
