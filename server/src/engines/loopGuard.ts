/**
 * Detects an agent that keeps repeating a tool call that fails. Small models do this with edit_file: the old_text never
 * matches, they send the same call again, and every turn re-sends the whole conversation, so it only gets slower.
 *
 * - The same failing call (same tool, same input) several times in a row: first a warning to the model, then a stop.
 * - Many failing calls in a row, even with different input: a stop. Any call that works resets both counters.
 */
export const LOOP_WARN_AFTER = 3;
export const LOOP_STOP_AFTER = 5;
export const FAIL_STREAK_STOP_AFTER = 12;

export type LoopVerdict = { action: "ok" } | { action: "warn"; repeats: number } | { action: "stop"; reason: string };

export class LoopGuard {
  private lastKey = "";
  private repeats = 0;
  private streak = 0;

  record(tool: string, input: unknown, isError: boolean): LoopVerdict {
    if (!isError) {
      this.lastKey = ""; this.repeats = 0; this.streak = 0;
      return { action: "ok" };
    }
    const key = `${tool}\u0000${stable(input)}`;
    this.repeats = key === this.lastKey ? this.repeats + 1 : 1;
    this.lastKey = key;
    this.streak++;
    if (this.repeats >= LOOP_STOP_AFTER) return { action: "stop", reason: `repeated the same failing ${tool} call ${this.repeats} times in a row` };
    if (this.streak >= FAIL_STREAK_STOP_AFTER) return { action: "stop", reason: `${this.streak} tool calls in a row failed` };
    if (this.repeats >= LOOP_WARN_AFTER) return { action: "warn", repeats: this.repeats };
    return { action: "ok" };
  }
}

/** The text added to the failing tool result so the model changes approach instead of sending the same call again. */
export function loopWarning(tool: string, repeats: number) {
  return `\n\nThis exact ${tool} call has now failed ${repeats} times in a row. Do not send it again. ` +
    (tool === "edit_file"
      ? "Read the file again with read_file and copy old_text exactly as it appears (same spaces and line breaks), with enough surrounding text to be unique, or use write_file with the whole file."
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
