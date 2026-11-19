import { ProviderError } from "./types.ts";

/**
 * The old hard-coded cap. A model that rejects the request without naming its own maximum is tried once at this
 * value, which every provider this app talks to accepted before the per-agent limit existed.
 */
export const FALLBACK_OUTPUT_CAP = 8192;

// The number we want is the model's maximum, not the value we sent (that one is also in the message).
const CAP_PATTERNS: RegExp[] = [
  />\s*(\d+)\s*,?\s*which is the maximum/i, // Anthropic: "32000 > 8192, which is the maximum allowed..."
  /at most (\d+) completion tokens/i, // OpenAI: "supports at most 16384 completion tokens"
  /(?:expected a value <=?|must be <=?|less than or equal to)\s*(\d+)/i,
  /maximum of (\d+)(?: output| completion)? tokens/i,
  /supports up to (\d+)/i,
  /(\d+)\s+is the maximum/i,
];

/** The output cap named in a provider error, when the message has one. */
export function outputCapFromError(message: string): number | null {
  for (const re of CAP_PATTERNS) {
    const m = re.exec(message);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return null;
}

function rejectsOutputCap(message: string): boolean {
  return /max_tokens|max_completion_tokens|output tokens|completion tokens/i.test(message)
    && /maximum|too (?:large|big|high)|exceed|at most|less than or equal|invalid/i.test(message);
}

/** The next lower cap to try, or null when this error is not "output cap too high". */
export function lowerOutputCap(status: number | undefined, message: string, sent: number): number | null {
  if (status !== 400 && status !== 422) return null;
  const named = outputCapFromError(message);
  if (named != null && named < sent) return named;
  if (named == null && rejectsOutputCap(message) && sent > FALLBACK_OUTPUT_CAP) return FALLBACK_OUTPUT_CAP;
  return null;
}

/**
 * Sends `requested`. When the model refuses that output cap, tries again with the cap it named
 * (or 8192 when it refuses without naming one), at most twice more. Any other error is rethrown,
 * so a bad key or an unknown model still fails the task.
 */
export async function withOutputCap<T>(requested: number, send: (maxTokens: number) => Promise<T>): Promise<{ value: T; maxTokens: number }> {
  let cap = requested;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { value: await send(cap), maxTokens: cap };
    } catch (err) {
      last = err;
      const next = err instanceof ProviderError ? lowerOutputCap(err.status, err.message, cap) : null;
      if (next == null) throw err;
      cap = next;
    }
  }
  throw last;
}
