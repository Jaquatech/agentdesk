/**
 * Limits for chat attachments, per file type. Stored as the `attachment_rules` setting (JSON).
 * Defaults are the values the attachment code used before these became settings. This file
 * imports nothing from the attachment code, so both sides can use it without a cycle.
 */

export type RuleKind = "text" | "csv" | "xlsx" | "docx" | "pdf" | "image";
export type RuleField = "partChars" | "maxRows" | "maxCols" | "maxMb";
export type KindRule = { enabled: boolean } & Partial<Record<RuleField, number>>;
export type AttachmentRules = Record<RuleKind, KindRule>;

/** Which fields each kind has. Anything else in a saved rule is dropped. */
export const RULE_FIELDS: Record<RuleKind, RuleField[]> = {
  text: ["partChars"],
  csv: ["partChars"],
  xlsx: ["partChars", "maxRows", "maxCols"],
  docx: ["partChars"],
  pdf: ["partChars"],
  image: ["maxMb"],
};

/** Allowed values. A number outside the range is clamped to it. */
export const FIELD_RANGE: Record<RuleField, { min: number; max: number }> = {
  partChars: { min: 2000, max: 100000 },
  maxRows: { min: 20, max: 5000 },
  maxCols: { min: 3, max: 200 },
  maxMb: { min: 1, max: 15 },
};

export const DEFAULT_RULES: AttachmentRules = {
  text: { enabled: true, partChars: 20000 },
  csv: { enabled: true, partChars: 20000 },
  xlsx: { enabled: true, partChars: 20000, maxRows: 200, maxCols: 20 },
  docx: { enabled: true, partChars: 20000 },
  pdf: { enabled: true, partChars: 20000 },
  image: { enabled: true, maxMb: 5 },
};

const KINDS = Object.keys(RULE_FIELDS) as RuleKind[];

const isPlainObject =(v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseEnabled(v: unknown, fallback: boolean): boolean {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return fallback;
}

function parseField(v: unknown, field: RuleField, fallback: number): number {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim() !== "") n = Number(v);
  else return fallback;
  if (!Number.isFinite(n)) return fallback;
  const { min, max } = FIELD_RANGE[field];
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * The rules from a JSON string or an object. Never throws and always returns a new object.
 * Anything missing or invalid gets the default for that kind or field.
 */
export function parseRules(raw: unknown): AttachmentRules {
  let source: unknown = raw;
  if (typeof raw === "string") {
    try { source = JSON.parse(raw); } catch { source = undefined; }
  }
  const all = isPlainObject(source) ? source : {};
  const out = {} as AttachmentRules;
  for (const kind of KINDS) {
    const def = DEFAULT_RULES[kind];
    const input = all[kind];
    const rule: Record<string, unknown> = { enabled: def.enabled };
    const from = isPlainObject(input) ? input : {};
    rule.enabled = parseEnabled(from.enabled, def.enabled);
    for (const field of RULE_FIELDS[kind]) {
      rule[field] = parseField(from[field], field, def[field] ?? 0);
    }
    out[kind] = rule as KindRule;
  }
  return out;
}

/** The rule kind for a text kind from attachmentMarkdown's textKind, or null when no rule covers it. */
export function ruleKindFor(kind: string): RuleKind | null {
  if (kind === "copy") return "text";
  if (kind === "csv" || kind === "tsv") return "csv";
  if (kind === "xlsx" || kind === "docx" || kind === "pdf") return kind;
  return null;
}
