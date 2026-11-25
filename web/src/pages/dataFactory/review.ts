/** Pure helpers for the Review tab. */

/** `12 of 40 answers voted`. */
export function progressLine(voted: number, total: number): string {
  return `${voted} of ${total} ${total === 1 ? "answer" : "answers"} voted`;
}

/** `75%` from a rate between 0 and 1; `-` when there is none. */
export function percentText(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "-";
  return `${Math.round(rate * 100)}%`;
}

/** What the judge's verdict says about the vote; null when no judge run covers the answer. */
export function agreementSentence(agrees: boolean | null | undefined): string | null {
  if (agrees === null || agrees === undefined) return null;
  return agrees ? "You and the judge agree" : "You and the judge disagree";
}

/** The index to show next, or null when the view is done. `voted[i]` is whether item i has a vote now. */
function nextIndex(voted: boolean[], from: number, unvotedOnly: boolean): number | null {
  if (!unvotedOnly) return from + 1 < voted.length ? from + 1 : null;
  for (let i = from + 1; i < voted.length; i++) if (!voted[i]) return i;
  for (let i = 0; i < from; i++) if (!voted[i]) return i;
  return null;
}

/** After a vote on item `from`: the next answer (with "Unvoted only", the next unvoted one, wrapping to skipped ones). */
export function nextAfterVote(voted: boolean[], from: number, unvotedOnly: boolean): number | null {
  const now = voted.slice();
  now[from] = true;
  return nextIndex(now, from, unvotedOnly);
}

/** After a skip of item `from`: the same choice, the skipped item stays unvoted. */
export function nextAfterSkip(voted: boolean[], from: number, unvotedOnly: boolean): number | null {
  const now = voted.slice();
  now[from] = false;
  return nextIndex(now, from, unvotedOnly);
}

/** The nearest earlier item voted in this session, or null. Pass `from = length` when the view is done. */
export function previousVoted(votedThisSession: boolean[], from: number): number | null {
  for (let i = Math.min(from, votedThisSession.length) - 1; i >= 0; i--) if (votedThisSession[i]) return i;
  return null;
}
