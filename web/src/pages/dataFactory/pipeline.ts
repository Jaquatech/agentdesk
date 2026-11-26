/** Pure helpers of the sensitive-data review: what to send, what to show. */

export type Kind = "secret" | "email" | "iban" | "personal_id" | "ip" | "host" | "phone" | "person" | "term";

export type Finding = {
  key: string; kind: Kind; value: string; placeholder: string; count: number; caseCount: number; examples: string[];
};

export type CaseView = { case_key: string; input: string; expected: string | null; tags: string[]; meta: Record<string, unknown> };
export type PreviewCase = { case_key: string; before: CaseView; after: CaseView };

const KIND_LABELS: Record<Kind, [string, string]> = {
  secret: ["secret", "secrets"],
  email: ["email address", "email addresses"],
  iban: ["IBAN", "IBANs"],
  personal_id: ["personal ID", "personal IDs"],
  ip: ["IP address", "IP addresses"],
  host: ["host name", "host names"],
  phone: ["phone number", "phone numbers"],
  person: ["person name", "person names"],
  term: ["listed term", "listed terms"],
};

/** The kind in words, singular or plural by `n`. An unknown kind is shown as it came. */
export function kindLabel(kind: string, n = 2): string {
  const l = KIND_LABELS[kind as Kind];
  return l ? l[n === 1 ? 0 : 1] : kind;
}

/** "2 email addresses, 1 phone number" from a map of counts; empty counts give "". */
export function countsLine(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${kindLabel(kind, n)}`)
    .join(", ");
}

/** The first approved version in the list's order (newest first), or null. */
export function firstApprovedVersion<T extends { approved_at: string | null }>(versions: T[]): T | null {
  return versions.find((v) => !!v.approved_at) ?? null;
}

/** The body of a check or approve request. A finding of a switched-off kind is not listed on its own. */
export function requestBody(findings: Finding[], offKeys: ReadonlySet<string>, offKinds: ReadonlySet<string>): { disabled_keys: string[]; disabled_kinds: string[] } {
  return {
    disabled_keys: findings.filter((f) => offKeys.has(f.key) && !offKinds.has(f.kind)).map((f) => f.key),
    disabled_kinds: [...offKinds].sort(),
  };
}

/** One entry per line: trimmed, no empty lines, no duplicates. */
export function parseTermLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ""))];
}

export type FieldChange = { field: string; before: string; after: string };

const show = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** The fields of a preview case that differ, with both texts. Fields that are the same are left out. */
export function changedFields(c: PreviewCase): FieldChange[] {
  const out: FieldChange[] = [];
  const add = (field: string, before: unknown, after: unknown) => {
    const b = show(before);
    const a = show(after);
    if (b !== a) out.push({ field, before: b, after: a });
  };
  add("input", c.before.input, c.after.input);
  add("expected", c.before.expected, c.after.expected);
  add("tags", c.before.tags.join(", "), c.after.tags.join(", "));
  const keys = new Set([...Object.keys(c.before.meta), ...Object.keys(c.after.meta)]);
  for (const k of [...keys].sort()) add(k, c.before.meta[k], c.after.meta[k]);
  return out;
}
