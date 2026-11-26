/**
 * Findings and replacement of sensitive data for a list of dataset cases. Pure: no database, no network, nothing
 * is logged. The matching rules are in sensitive.ts.
 */
import { createHash } from "node:crypto";
import { findSensitive, type SensitiveKind, type SensitiveMatch, type SensitiveTerms } from "./sensitive.ts";

export type CaseLike = {
  id: string;
  input: string;
  expected?: string | null;
  tags: string[];
  meta: Record<string, unknown>;
};

export type Finding = {
  key: string;
  kind: SensitiveKind;
  value: string;
  placeholder: string;
  count: number;
  caseCount: number;
  examples: string[];
};

export type AnonymizeOptions = { disabledKeys?: Iterable<string>; disabledKinds?: Iterable<SensitiveKind> };
export type AnonymizeResult<C extends CaseLike> = {
  cases: C[];
  changed: number[];
  counts: Partial<Record<SensitiveKind, number>>;
};

const PREFIX: Record<SensitiveKind, string> = {
  person: "Person",
  term: "Term",
  email: "Email",
  phone: "Phone",
  personal_id: "ID",
  iban: "IBAN",
  ip: "IP",
  host: "Host",
  secret: "Secret",
};

const PLACEHOLDER_IN_TEXT = /(?<![A-Za-z0-9_])(?:Person|Term|Email|Phone|ID|IBAN|IP|Host|Secret)_\d+(?![A-Za-z0-9_])/g;
const WORD_ONLY = /^[\p{L}\p{M}\p{N}_]+$/u;
const MAX_EXAMPLES = 3;
const EXAMPLE_CHARS = 80;

// ---- walking a case in the fixed order: id, input, expected, tags, meta values ----

function mapMeta(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (typeof value === "number") {
    const text = String(value);
    const next = fn(text);
    return next === text ? value : next;
  }
  if (Array.isArray(value)) return value.map((v) => mapMeta(v, fn));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapMeta(v, fn)]));
  }
  return value;
}

function mapCase<C extends CaseLike>(c: C, fn: (text: string) => string): C {
  const out: CaseLike = { ...c, id: fn(c.id), input: fn(c.input) };
  if (typeof c.expected === "string") out.expected = fn(c.expected);
  out.tags = c.tags.map((t) => fn(t));
  out.meta = mapMeta(c.meta, fn) as Record<string, unknown>;
  return out as C;
}

// ---- keys ----

type Normaliser = (match: SensitiveMatch) => string;

/** A `*` entry gives all word forms one value: the longest matching prefix stands for them. */
function normaliser(terms: SensitiveTerms): Normaliser {
  const stars = (entries: string[]) =>
    entries
      .map((e) => e.trim())
      .filter((e) => e.endsWith("*") && e.length > 2)
      .map((e) => e.slice(0, -1).trim().toLowerCase())
      .filter((p) => p.length >= 2)
      .sort((a, b) => b.length - a.length);
  const prefixes = { person: stars(terms.people), term: stars(terms.terms) };
  return (m) => {
    const lower = m.value.toLowerCase();
    if (m.kind === "person" || m.kind === "term") {
      if (WORD_ONLY.test(m.value)) {
        const prefix = prefixes[m.kind].find((p) => lower.startsWith(p));
        if (prefix) return `${prefix}*`;
      }
      return lower;
    }
    if (m.kind === "phone" || m.kind === "iban") return lower.replace(/[\s-]/g, "");
    return lower;
  };
}

function keyOf(kind: SensitiveKind, normalised: string): string {
  return createHash("sha256").update(`${kind}\0${normalised}`).digest("hex").slice(0, 12);
}

function snippet(text: string, m: SensitiveMatch): string {
  const room = EXAMPLE_CHARS - (m.end - m.start);
  if (room <= 0) return text.slice(m.start, m.start + EXAMPLE_CHARS).replace(/\s/g, " ");
  const before = Math.floor(room / 2);
  const from = Math.max(0, m.start - before);
  const to = Math.min(text.length, m.end + (room - (m.start - from)));
  return text.slice(from, to).replace(/\s/g, " ");
}

// ---- scanning ----

type Scan = { findings: Finding[]; byKey: Map<string, Finding> };

function scan(cases: CaseLike[], terms: SensitiveTerms): Scan {
  const normalise = normaliser(terms);
  const byKey = new Map<string, Finding>();
  const caseSets = new Map<string, Set<number>>();
  const existing = new Set<string>();
  cases.forEach((c, index) => {
    mapCase(c, (text) => {
      for (const p of text.matchAll(PLACEHOLDER_IN_TEXT)) existing.add(p[0]);
      for (const m of findSensitive(text, terms)) {
        const key = keyOf(m.kind, normalise(m));
        let f = byKey.get(key);
        if (!f) {
          f = { key, kind: m.kind, value: m.value, placeholder: "", count: 0, caseCount: 0, examples: [] };
          byKey.set(key, f);
          caseSets.set(key, new Set());
        }
        f.count++;
        caseSets.get(key)?.add(index);
        if (f.examples.length < MAX_EXAMPLES) {
          const s = snippet(text, m);
          if (!f.examples.includes(s)) f.examples.push(s);
        }
      }
      return text;
    });
  });
  const next: Partial<Record<SensitiveKind, number>> = {};
  for (const f of byKey.values()) {
    f.caseCount = caseSets.get(f.key)?.size ?? 0;
    let n = next[f.kind] ?? 0;
    let placeholder: string;
    do {
      n++;
      placeholder = `${PREFIX[f.kind]}_${n}`;
    } while (existing.has(placeholder));
    next[f.kind] = n;
    f.placeholder = placeholder;
  }
  return { findings: [...byKey.values()], byKey };
}

export function scanCases(cases: CaseLike[], terms: SensitiveTerms): Finding[] {
  return scan(cases, terms).findings;
}

// ---- replacing ----

function uniqueId(id: string, seen: Set<string>): string {
  if (!seen.has(id)) return id;
  let n = 2;
  while (seen.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

export function anonymizeCases<C extends CaseLike>(
  cases: C[],
  terms: SensitiveTerms,
  options: AnonymizeOptions = {},
): AnonymizeResult<C> {
  const { byKey } = scan(cases, terms);
  const normalise = normaliser(terms);
  const disabledKeys = new Set(options.disabledKeys ?? []);
  const disabledKinds = new Set(options.disabledKinds ?? []);
  const counts: Partial<Record<SensitiveKind, number>> = {};
  const replaceIn = (text: string): string => {
    let out = "";
    let at = 0;
    for (const m of findSensitive(text, terms)) {
      const key = keyOf(m.kind, normalise(m));
      const finding = byKey.get(key);
      if (!finding || disabledKeys.has(key) || disabledKinds.has(m.kind)) continue;
      out += text.slice(at, m.start) + finding.placeholder;
      at = m.end;
      counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    }
    return out + text.slice(at);
  };

  const seenIds = new Set<string>();
  const changed: number[] = [];
  const result = cases.map((c, index) => {
    const next = mapCase(c, replaceIn);
    const idChanged = next.id !== c.id;
    if (idChanged) next.id = uniqueId(next.id, seenIds);
    seenIds.add(next.id);
    if (JSON.stringify(next) !== JSON.stringify(c)) changed.push(index);
    return next;
  });
  return { cases: result, changed, counts };
}
