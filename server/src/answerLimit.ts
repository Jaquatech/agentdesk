/** Tokens one model reply may use. Reasoning models spend these on thinking before any answer. */
export const DEFAULT_MAX_ANSWER_TOKENS = 32_000;
export const MIN_MAX_ANSWER_TOKENS = 1024;
export const MAX_MAX_ANSWER_TOKENS = 128_000;

/**
 * The cap to send. A missing or unusable value (rows from before the column, a bad read) becomes the default.
 * A number outside the allowed range is pulled back inside it, so a call is never sent with 0 or an unbounded cap.
 */
export function answerLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return DEFAULT_MAX_ANSWER_TOKENS;
  return Math.min(MAX_MAX_ANSWER_TOKENS, Math.max(MIN_MAX_ANSWER_TOKENS, n));
}

const RANGE = `Max answer tokens must be a whole number from ${MIN_MAX_ANSWER_TOKENS} to ${MAX_MAX_ANSWER_TOKENS}.`;

/** Blank means the default. Anything else must be a whole number inside the range. */
export function parseMaxAnswerTokens(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: DEFAULT_MAX_ANSWER_TOKENS };
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(n) || n < MIN_MAX_ANSWER_TOKENS || n > MAX_MAX_ANSWER_TOKENS) return { ok: false, error: RANGE };
  return { ok: true, value: n };
}

/**
 * Run-log note when a reply hits the output cap with no text and no tool call.
 * `accepted` is the cap the model actually used, lower than `configured` when the provider had to step down.
 */
export function emptyAnswerNote(configured: number, accepted: number, thinkingOff: boolean): string {
  const clamped = accepted < configured;
  const head = clamped
    ? `Used the whole answer limit (${accepted} tokens) on thinking and gave no answer. This agent's Max answer tokens is ${configured}; the model only accepted ${accepted}.`
    : `Used the whole answer limit (${configured} tokens) on thinking and gave no answer.`;
  if (clamped) {
    return head + (thinkingOff
      ? " Raising Max answer tokens will not help until the model allows more."
      : " Set Thinking to Off for this agent to get answers faster. Raising Max answer tokens will not help until the model allows more.");
  }
  return head + (thinkingOff
    ? " Raise Max answer tokens for this agent."
    : " Raise Max answer tokens for this agent, or set Thinking to Off to get answers faster.");
}
