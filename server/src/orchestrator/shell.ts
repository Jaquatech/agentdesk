import { spawn } from "node:child_process";

export type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

export type RunOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  stdin?: string;
  signal?: AbortSignal;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
};

const IS_WIN = process.platform === "win32";

/**
 * On Windows, .cmd shims like `claude`, `npm` and `az` need the shell; real executables do not. `git` and `gh` are .exe files
 * that CreateProcess finds by bare name. Through cmd.exe an argument with a line break (a release commit message) is cut at
 * the first line: git then got `merge -m "Sprint 1…` without the branch and merged nothing, with exit code 0.
 */
export function needsShell(program: string, win = IS_WIN) {
  return win && !/^(git|gh|taskkill)$|\.(exe|com)$/i.test(program);
}

/** Runs a program with arguments (no shell unless it is a .cmd shim, see needsShell). */
export function runProgram(program: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const useShell = needsShell(program);
    const child = spawn(useShell ? quoteWin(program, args) : program, useShell ? [] : args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: useShell,
      windowsHide: true,
    });
    let stdout = "", stderr = "", timedOut = false;
    const buffers = { stdout: "", stderr: "" };
    const feed = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout += text; else stderr += text;
      if (!opts.onLine) return;
      buffers[stream] += text;
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() ?? "";
      for (const l of lines) opts.onLine(l, stream);
    };
    child.stdout.on("data", (c) => feed("stdout", c));
    child.stderr.on("data", (c) => feed("stderr", c));

    const kill = () => {
      if (IS_WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    };
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs) : undefined;
    opts.signal?.addEventListener("abort", kill, { once: true });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (opts.onLine) {
        if (buffers.stdout) opts.onLine(buffers.stdout, "stdout");
        if (buffers.stderr) opts.onLine(buffers.stderr, "stderr");
      }
      resolve({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut });
    });
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

function quoteWin(program: string, args: string[]) {
  const q = (s: string) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [q(program), ...args.map(q)].join(" ");
}

export type ShellKind = "auto" | "powershell" | "bash" | "cmd" | "sh";

/**
 * Runs one project command line (setup / verify). Every part of a `;` or `&&` chain must succeed:
 * PowerShell would otherwise report only the last part's exit code and hide a failed build.
 */
export function runCommandLine(line: string, shell: ShellKind, opts: RunOptions): Promise<RunResult> {
  const kind = shell === "auto" ? (IS_WIN ? "powershell" : "bash") : shell;
  if (kind === "powershell") {
    const parts = splitChain(line);
    const script = "$ErrorActionPreference = 'Stop'; " +
      parts.map((p) => `${p}; if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`).join("; ");
    return runProgram(IS_WIN ? "powershell.exe" : "pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], opts);
  }
  if (kind === "cmd") return runProgram("cmd.exe", ["/d", "/s", "/c", line], opts);
  const prog = kind === "bash" ? "bash" : "sh";
  const parts = splitChain(line);
  return runProgram(prog, ["-c", `set -e; ${parts.join(" && ")}`], opts);
}

/** Splits `a; b && c` at top-level separators (not inside quotes). */
export function splitChain(line: string): string[] {
  const parts: string[] = [];
  let cur = "", quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === ";") { parts.push(cur); cur = ""; continue; }
    if (ch === "&" && line[i + 1] === "&") { parts.push(cur); cur = ""; i++; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function tail(text: string, n = 30): string {
  return text.trimEnd().split(/\r?\n/).slice(-n).join("\n");
}
