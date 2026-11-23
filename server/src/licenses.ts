import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One installed dependency from the root package-lock.json. */
export type Pkg = { name: string; version: string; license: string };

export type ThirdParty = { own: string; licenses: Record<string, number>; packages: Pkg[] };

const NO_LICENSE = "(none)";
const PREFIX = "node_modules/";

/** Licences that may ship in the product. File-level and permissive only: GPL/AGPL would change what the owner can distribute. */
export const ALLOWED_LICENSES: string[] = [
  "MIT", "ISC", "BSD", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "BlueOak-1.0.0", "MPL-2.0", "OFL-1.1",
  "CC0-1.0", "CC-BY-4.0", "Unlicense", "Python-2.0",
];

/** Dependencies only (dev and linked entries are left out) with name, version and licence, sorted by name then version. */
export function collectPackages(lock: unknown): Pkg[] {
  const packages = (lock as { packages?: Record<string, unknown> } | null)?.packages ?? {};
  const seen = new Set<string>();
  const out: Pkg[] = [];
  for (const [key, value] of Object.entries(packages)) {
    if (!key.startsWith(PREFIX) || !value || typeof value !== "object") continue;
    const entry = value as { version?: unknown; license?: unknown; dev?: unknown; link?: unknown };
    if (entry.dev === true || entry.link === true) continue;
    const name = key.slice(key.lastIndexOf(PREFIX) + PREFIX.length);
    const version = typeof entry.version === "string" ? entry.version : "";
    const license = typeof entry.license === "string" ? entry.license : "";
    const id = `${name}\0${version}\0${license}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, version, license });
  }
  return out.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
  });
}

/** SPDX-like expression: parentheses are ignored, ` OR ` alternatives pass when any one passes, ` AND ` parts pass when all pass. */
export function licenseAllowed(expr: string | undefined): boolean {
  if (!expr) return false;
  const alternatives = expr.replace(/[()]/g, "").split(" OR ");
  return alternatives.some((alt) => alt.split(" AND ").every((part) => ALLOWED_LICENSES.includes(part.trim())));
}

/** One line per package that has no licence or a licence outside the allow-list. */
export function licenseProblems(pkgs: Pkg[]): string[] {
  const out: string[] = [];
  for (const p of pkgs) {
    if (!p.license) out.push(`${p.name}@${p.version}: no licence field`);
    else if (!licenseAllowed(p.license)) out.push(`${p.name}@${p.version}: ${p.license} is not on the allow-list`);
  }
  return out;
}

/** Package count per licence, for the notices and the Version page. */
export function countLicenses(pkgs: Pkg[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pkgs) {
    const key = p.license || NO_LICENSE;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The notices file: the own licence line, a count per licence, then one table row per package. */
export function renderNotices(pkgs: Pkg[], ownCopyright: string): string {
  const counts = Object.entries(countLicenses(pkgs)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const own = ownCopyright.replace(/\.$/, "");
  const lines = [
    "# Third-party notices",
    "",
    `AgentDesk is MIT licensed (see LICENSE).${own ? ` ${own}.` : ""} It uses the packages below; each keeps its own licence, whose text ships with the package.`,
    "",
    ...counts.map(([license, n]) => `- ${license}: ${n}`),
    "",
    "| Package | Version | Licence |",
    "|---|---|---|",
    ...pkgs.map((p) => `| ${p.name} | ${p.version} | ${(p.license || NO_LICENSE).replace(/\|/g, "\\|")} |`),
    "",
  ];
  return lines.join("\n");
}

/** True when every package appears as a table row starting `| name | version |` in the markdown. */
export function noticesCurrent(pkgs: Pkg[], markdown: string): boolean {
  const rows = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\| ([^|]+?) \| ([^|]+?) \|/.exec(line);
    if (m) rows.add(`${m[1]}@${m[2]}`);
  }
  return pkgs.every((p) => rows.has(`${p.name}@${p.version}`));
}

/** The repository root: two folders above this file (server/src). */
export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The generated docs/third-party.json; empty when it is missing or unreadable. */
export function readThirdParty(root: string): ThirdParty {
  try {
    const data = JSON.parse(readFileSync(join(root, "docs", "third-party.json"), "utf8"));
    const packages: Pkg[] = Array.isArray(data.packages)
      ? data.packages.map((p: Partial<Pkg>) => ({ name: String(p.name ?? ""), version: String(p.version ?? ""), license: String(p.license ?? "") }))
      : [];
    const licenses: Record<string, number> = {};
    for (const [k, v] of Object.entries(data.licenses ?? {})) licenses[k] = Number(v);
    return { own: String(data.own ?? ""), licenses, packages };
  } catch {
    return { own: "", licenses: {}, packages: [] };
  }
}
