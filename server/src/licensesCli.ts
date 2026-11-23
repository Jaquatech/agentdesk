// Generates THIRD_PARTY_NOTICES.md and docs/third-party.json from the root package-lock.json.
// `--check` writes nothing and fails on a licence problem or a stale notices file (CI runs it).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectPackages, countLicenses, licenseProblems, noticesCurrent, renderNotices, repoRoot } from "./licenses.ts";

const root = repoRoot();
const check = process.argv.includes("--check");
const pkgs = collectPackages(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")));
const license = existsSync(join(root, "LICENSE")) ? readFileSync(join(root, "LICENSE"), "utf8") : "";
const own = license.split(/\r?\n/).find((l) => l.startsWith("Copyright"))?.trim() ?? "";
const problems = licenseProblems(pkgs);
const noticesPath = join(root, "THIRD_PARTY_NOTICES.md");

if (check) {
  for (const p of problems) console.log(p);
  if (!existsSync(noticesPath) || !noticesCurrent(pkgs, readFileSync(noticesPath, "utf8"))) {
    console.log("THIRD_PARTY_NOTICES.md is out of date: run npm run licenses --workspace server");
    problems.push("stale notices");
  }
  if (problems.length) process.exit(1);
  console.log(`ok: ${pkgs.length} packages`);
} else {
  writeFileSync(noticesPath, renderNotices(pkgs, own));
  writeFileSync(join(root, "docs", "third-party.json"), JSON.stringify({ own, licenses: countLicenses(pkgs), packages: pkgs }, null, 2) + "\n");
  console.log(`${pkgs.length} packages written to THIRD_PARTY_NOTICES.md and docs/third-party.json`);
  if (problems.length) {
    for (const p of problems) console.log(p);
    process.exit(1);
  }
}
