/**
 * Finds sensitive data in one string with local rules only. Pure: no database, no network, no model, and nothing is
 * logged. Every pattern avoids nested open-ended repetition (emails are found around each "@" by hand), so a long
 * adversarial text stays fast.
 */
import { isIP } from "node:net";

export type SensitiveKind =
  | "secret"
  | "email"
  | "iban"
  | "personal_id"
  | "ip"
  | "host"
  | "phone"
  | "person"
  | "term";

/** Highest priority first: a match that overlaps one of an earlier kind is dropped. */
export const SENSITIVE_KINDS: readonly SensitiveKind[] = [
  "secret",
  "email",
  "iban",
  "personal_id",
  "ip",
  "host",
  "phone",
  "person",
  "term",
];

export type SensitiveMatch = { kind: SensitiveKind; start: number; end: number; value: string };
export type SensitiveTerms = { people: string[]; terms: string[] };

type Span = { start: number; end: number };

/** What the anonymizer writes in place of a value; such text is never reported again. */
export const PLACEHOLDER_SHAPE = /^(?:Person|Term|Email|Phone|ID|IBAN|IP|Host|Secret)_\d+$/;

const WORD = "[\\p{L}\\p{M}\\p{N}_]";

// ---- secrets ----

const TOKEN_RE =
  /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{16,}|gh[po]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/g;
const JWT_RE = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const KEY_BEGIN_RE = /-----BEGIN (?:[A-Z]+ ){0,3}PRIVATE KEY-----/g;
const KEY_VALUE_RE =
  /(?<![A-Za-z])(?:password|passwd|pwd|salasana|secret|token|api_key|api-key|apikey)["']?[ \t]*[:=][ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,;"'&]+))/gid;

function secretSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const re of [TOKEN_RE, JWT_RE]) {
    for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(KEY_BEGIN_RE)) {
    const from = m.index + m[0].length;
    const endLine = text.indexOf("-----END", from);
    let end = text.length;
    if (endLine !== -1) {
      const close = text.indexOf("-----", endLine + 8);
      if (close !== -1) end = close + 5;
      else {
        const nl = text.indexOf("\n", endLine);
        end = nl === -1 ? text.length : nl;
        if (text[end - 1] === "\r") end--;
      }
    }
    out.push({ start: m.index, end });
  }
  for (const m of text.matchAll(KEY_VALUE_RE)) {
    const group = m.indices?.slice(1).find((g) => g !== undefined);
    if (group && group[1] > group[0]) out.push({ start: group[0], end: group[1] });
  }
  return out;
}

// ---- email ----

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const DOMAIN_CHAR = /[A-Za-z0-9.-]/;
const DOMAIN_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function emailSpans(text: string): Span[] {
  const out: Span[] = [];
  let at = text.indexOf("@");
  while (at !== -1) {
    let start = at;
    while (start > 0 && at - start < 64 && LOCAL_CHAR.test(text[start - 1])) start--;
    while (start < at && text[start] === ".") start++;
    let end = at + 1;
    while (end < text.length && end - at < 256 && DOMAIN_CHAR.test(text[end])) end++;
    while (end > at + 1 && (text[end - 1] === "." || text[end - 1] === "-")) end--;
    const domain = text.slice(at + 1, end);
    if (start < at && DOMAIN_RE.test(domain) && /[A-Za-z]{2,}$/.test(domain)) {
      out.push({ start, end });
      at = text.indexOf("@", end);
    } else {
      at = text.indexOf("@", at + 1);
    }
  }
  return out;
}

// ---- iban ----

const IBAN_RE = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,30}/g;
const ALNUM = /[A-Za-z0-9]/;

function ibanChecks(compact: string): boolean {
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const digits = ch >= "0" && ch <= "9" ? ch : String(ch.toUpperCase().charCodeAt(0) - 55);
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

function ibanSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(IBAN_RE)) {
    const raw = m[0];
    for (let i = raw.length; i > 0; i--) {
      if (raw[i - 1] === " ") continue;
      const next = i < raw.length ? raw[i] : (text[m.index + raw.length] ?? "");
      if (ALNUM.test(next)) continue;
      const compact = raw.slice(0, i).replace(/ /g, "");
      if (compact.length < 15) break;
      if (ibanChecks(compact)) {
        out.push({ start: m.index, end: m.index + i });
        break;
      }
    }
  }
  return out;
}

// ---- Finnish personal id ----

const PERSONAL_ID_RE = /(?<![A-Za-z0-9])(\d{2})(\d{2})\d{2}[+\-YXWVUABCDEF]\d{3}[0-9A-Z](?![A-Za-z0-9])/gi;
const CHECK_CHARS = "0123456789ABCDEFHJKLMNPRSTUVWXY";

function personalIdSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(PERSONAL_ID_RE)) {
    const id = m[0];
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    const check = CHECK_CHARS[Number(id.slice(0, 6) + id.slice(7, 10)) % 31];
    if (id[10].toUpperCase() === check) out.push({ start: m.index, end: m.index + id.length });
  }
  return out;
}

// ---- ip ----

const IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g;
const IPV6_RE = /(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])(?!\.\d)/g;

function ipSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(IPV4_RE)) {
    if (m[0].split(".").every((p) => Number(p) <= 255)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(IPV6_RE)) {
    if (/[0-9A-Fa-f]/.test(m[0]) && isIP(m[0]) === 6) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---- host ----

const HOST_RE =
  /(?<![\w.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:local|lan|internal|corp|intra|com|net|org|io|eu|fi|se|no|dk|de|uk|cloud|app|dev)(?![\w-])/gi;

function hostSpans(text: string): Span[] {
  return Array.from(text.matchAll(HOST_RE), (m) => ({ start: m.index, end: m.index + m[0].length }));
}

// ---- phone ----

const PHONE_RE = /(?<![\w.+])[+0][\d ()-]{6,24}/g;
const DATE_SHAPES = [/^\d{1,2}[-. ]\d{1,2}[-. ]\d{2,4}$/, /^\d{4}[-. ]\d{1,2}[-. ]\d{1,2}$/];
const WORD_CHAR = new RegExp(WORD, "u");

function phoneSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    let raw = m[0];
    while (raw.length > 0 && !/[\d)]/.test(raw[raw.length - 1])) raw = raw.slice(0, -1);
    const digits = raw.replace(/\D/g, "").length;
    if (digits < 7 || digits > 15) continue;
    if (WORD_CHAR.test(text[m.index + raw.length] ?? "")) continue;
    if (DATE_SHAPES.some((d) => d.test(raw))) continue;
    let open = 0;
    let close = 0;
    let ok = true;
    for (let i = 1; i < raw.length && ok; i++) {
      const ch = raw[i];
      const prev = raw[i - 1];
      if (ch === " " || ch === "-") ok = prev !== " " && prev !== "-" && prev !== "(";
      else if (ch === "(") ok = ++open === 1;
      else if (ch === ")") ok = ++close === 1 && open === 1 && prev >= "0" && prev <= "9";
    }
    if (ok && open === close) out.push({ start: m.index, end: m.index + raw.length });
  }
  return out;
}

// ---- the user's own entries ----

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function entrySpans(text: string, entries: string[]): Span[] {
  const out: Span[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim();
    const star = entry.endsWith("*");
    const base = star ? entry.slice(0, -1).trim() : entry;
    if (entry.length < 2 || base.length < 2) continue;
    const key = (star ? "*" : "") + base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const body = base.replace(REGEX_SPECIAL, "\\$&");
    const re = new RegExp(`(?<!${WORD})${body}${star ? `${WORD}*` : `(?!${WORD})`}`, "giu");
    for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Non-overlapping matches in text order. */
export function findSensitive(text: string, terms: SensitiveTerms): SensitiveMatch[] {
  const found: Record<SensitiveKind, Span[]> = {
    secret: secretSpans(text),
    email: emailSpans(text),
    iban: ibanSpans(text),
    personal_id: personalIdSpans(text),
    ip: ipSpans(text),
    host: hostSpans(text),
    phone: phoneSpans(text),
    person: entrySpans(text, terms.people),
    term: entrySpans(text, terms.terms),
  };
  const taken = new Uint8Array(text.length);
  const out: SensitiveMatch[] = [];
  for (const kind of SENSITIVE_KINDS) {
    const spans = found[kind].slice().sort((a, b) => a.start - b.start || b.end - a.end);
    for (const s of spans) {
      const value = text.slice(s.start, s.end);
      if (PLACEHOLDER_SHAPE.test(value)) continue;
      let free = true;
      for (let i = s.start; i < s.end; i++) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      out.push({ kind, start: s.start, end: s.end, value });
      taken.fill(1, s.start, s.end);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
