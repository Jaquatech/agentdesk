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

export type VoteFilter = "all" | "agree" | "disagree" | "no_judge";

export const VOTE_FILTERS: { value: VoteFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "agree", label: "Agree" },
  { value: "disagree", label: "Disagree" },
  { value: "no_judge", label: "No judge" },
];

/** The word for the Agreement column: text, so colour is never the only signal. */
export function agreementWord(agrees: boolean | null | undefined): "Agree" | "Disagree" | "No judge" {
  if (agrees === null || agrees === undefined) return "No judge";
  return agrees ? "Agree" : "Disagree";
}

/** The filter the Your votes card opens with: the disagreements when there are any, else all. */
export function defaultVoteFilter(disagreeTotal: number | null | undefined): VoteFilter {
  return typeof disagreeTotal === "number" && disagreeTotal > 0 ? "disagree" : "all";
}

/** `Good` or `Bad`; `-` when there is no vote. */
export function voteLabel(verdict: "good" | "bad" | null | undefined): string {
  if (verdict === "good") return "Good";
  if (verdict === "bad") return "Bad";
  return "-";
}

/** `8, pass` / `3, fail` / `pass` (no score); `No judge` when no judge run covers the answer. */
export function judgeLabel(judge: { score: number | null; pass: boolean } | null | undefined): string {
  if (!judge) return "No judge";
  const verdict = judge.pass ? "pass" : "fail";
  return judge.score === null || judge.score === undefined ? verdict : `${judge.score}, ${verdict}`;
}

/** What the review card shows for the model: hidden while the setting is on and the answer has no vote yet. */
export function modelShown(hide: boolean, voted: boolean, model: string, provider: string): string {
  return hide && !voted ? "Model hidden" : `${model} (${provider})`;
}

const HIDE_KEY = "agentdesk.review.hideModels";

/** Hide model names while voting: on unless the browser remembers it was turned off. Storage may fail. */
export function readHideModels(): boolean {
  try { return localStorage.getItem(HIDE_KEY) !== "0"; } catch { return true; }
}

export function saveHideModels(hide: boolean): void {
  try { localStorage.setItem(HIDE_KEY, hide ? "1" : "0"); } catch { /* the page works without storage */ }
}

/** The nearest earlier item voted in this session, or null. Pass `from = length` when the view is done. */
export function previousVoted(votedThisSession: boolean[], from: number): number | null {
  for (let i = Math.min(from, votedThisSession.length) - 1; i >= 0; i--) if (votedThisSession[i]) return i;
  return null;
}
