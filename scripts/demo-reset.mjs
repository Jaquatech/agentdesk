// Clears the demo data so the next `npm run demo` starts from the seed again.
// A demo server left running (on Windows Ctrl+C can leave the child behind) keeps the database file open,
// so this stops those first. It only touches node processes started with `src/index.ts --demo`.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "data-demo");

function demoServerPids() {
  try {
    if (process.platform === "win32") {
      const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'index\\.ts' -and $_.CommandLine -match '--demo' } | ForEach-Object { $_.ProcessId }";
      return execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).split(/\s+/).filter(Boolean).map(Number);
    }
    return execFileSync("pgrep", ["-f", "index\\.ts --demo"], { encoding: "utf8" }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; } // no match, or no pgrep
}

for (const pid of demoServerPids()) {
  if (pid === process.pid) continue;
  try { process.kill(pid); console.log(`Stopped demo server (process ${pid})`); } catch { /* already gone */ }
}

if (!existsSync(target)) { console.log("No demo data to clear."); process.exit(0); }
// Windows releases the file a moment after the process ends, so retry a few times.
for (let i = 0; i < 10; i++) {
  try { rmSync(target, { recursive: true, force: true }); console.log("Demo data cleared. Run: npm run demo"); process.exit(0); }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
console.error("Could not clear data-demo: a program still has a file open. Close it and run this again.");
process.exit(1);
