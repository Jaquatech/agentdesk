/**
 * Detects an agent that keeps failing the same kind of tool call. Small models do this with edit_file: the old_text never
 * matches, they read the file again, try again, and every turn re-sends the whole conversation, so it only gets slower.
 * Reading in between does not help them, so a successful read must not reset anything: only a success of the same tool does.
 *
 * - File tools (edit_file, write_file): failures in a row without a success of that tool. Warn at 3, stop at 6.
 * - Any tool: the same call (same tool, same input) failing again and again without a success of that tool in between.
 *   Warn at 3, stop at 5. Commands such as tests may legitimately fail many times with different input, so they are not
 *   stopped just for failing.
 */
export const LOOP_WARN_AFTER = 3;
export const SAME_CALL_STOP_AFTER = 5;
export const FILE_TOOL_STOP_AFTER = 6;
const FILE_TOOLS = new Set(["edit_file", "write_file"]);

export type LoopVerdict = { action: "ok" } | { action: "warn"; repeats: number } | { action: "stop"; reason: string };

export class LoopGuard {
  private toolFails = new Map<string, number>();
  private sameCall = new Map<string, number>();

  record(tool: string, input: unknown, isError: boolean): LoopVerdict {
    if (!isError) {
      // Progress by this tool: forget its failures (other tools' successes, such as reads, change nothing).
      this.toolFails.delete(tool);
      for (const key of this.sameCall.keys()) if (key.startsWith(`${tool}\u0000`)) this.sameCall.delete(key);
      return { action: "ok" };
    }
    const fails = (this.toolFails.get(tool) ?? 0) + 1;
    this.toolFails.set(tool, fails);
    const key = `${tool}\u0000${stable(input)}`;
    const same = (this.sameCall.get(key) ?? 0) + 1;
    this.sameCall.set(key, same);

    if (same >= SAME_CALL_STOP_AFTER) return { action: "stop", reason: `repeated the same failing ${tool} call ${same} times` };
    if (FILE_TOOLS.has(tool) && fails >= FILE_TOOL_STOP_AFTER) return { action: "stop", reason: `failed ${fails} ${tool} calls in a row without one working` };
    const repeats = FILE_TOOLS.has(tool) ? fails : same;
    if (repeats >= LOOP_WARN_AFTER) return { action: "warn", repeats };
    return { action: "ok" };
  }
}

/** The text added to the failing tool result so the model changes approach instead of sending the same call again. */
export function loopWarning(tool: string, repeats: number) {
  return `\n\nThis ${tool} call has now failed ${repeats} times in a row. Do not send it again as it is. ` +
    (tool === "edit_file"
      ? "Reading the file again did not help: the old_text is still not matching. Copy it exactly from the file (same spaces and line breaks) and keep it short, or use write_file with the whole file."
      : "Look at the error, change the input, or try a different tool.");
}

/** Same JSON whatever the key order, so a reordered but identical call still counts as a repeat. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}
