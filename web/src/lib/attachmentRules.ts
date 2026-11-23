// Attachment limits per file type. Pure helpers for AttachmentsPage; the server owns the defaults and the checks.

export type RuleKind = "text" | "csv" | "xlsx" | "docx" | "pdf" | "image";
export type RuleField = "partChars" | "maxRows" | "maxCols" | "maxMb";
export type KindRule = { enabled: boolean } & Partial<Record<RuleField, number>>;
export type AttachmentRules = Record<RuleKind, KindRule>;
export type RulesPayload = {
  rules: AttachmentRules;
  defaults: AttachmentRules;
  fields: Record<RuleKind, RuleField[]>;
  ranges: Record<RuleField, { min: number; max: number }>;
};

export const KIND_ORDER: RuleKind[] = ["text", "csv", "xlsx", "docx", "pdf", "image"];

export const KIND_INFO: Record<RuleKind, { label: string; files: string; enabledLabel: string }> = {
  text: { label: "Text and code", files: ".txt, .md, .json, .xml, .log, .yaml and source files", enabledLabel: "Make a Markdown copy" },
  csv: { label: "CSV and TSV tables", files: ".csv, .tsv", enabledLabel: "Make a Markdown copy" },
  xlsx: { label: "Excel workbooks", files: ".xlsx (older .xls files are only named)", enabledLabel: "Make a Markdown copy" },
  docx: { label: "Word documents", files: ".docx (older .doc files are only named)", enabledLabel: "Make a Markdown copy" },
  pdf: { label: "PDF files", files: "PDFs with a text layer (scanned pages are not read yet)", enabledLabel: "Make a Markdown copy" },
  image: { label: "Images", files: "PNG, JPG, GIF, WebP", enabledLabel: "Send images to models that can read them" },
};

export const FIELD_INFO: Record<RuleField, { label: string; hint: string }> = {
  partChars: {
    label: "Characters sent with the message",
    hint: "The first part goes with your message and the agent asks for later parts by number. A smaller number costs fewer tokens per message.",
  },
  maxRows: { label: "Rows kept per sheet", hint: "Further rows are counted in a note in the copy." },
  maxCols: { label: "Columns kept per sheet", hint: "Further columns are counted in a note in the copy." },
  maxMb: { label: "Largest image sent (MB)", hint: "Larger images are only named." },
};

const FIELDS: RuleField[] = ["partChars", "maxRows", "maxCols", "maxMb"];

/** Returns a new rules object with one value changed; the input is not modified. */
export function withRuleValue(rules: AttachmentRules, kind: RuleKind, key: "enabled" | RuleField, value: boolean | number): AttachmentRules {
  return { ...rules, [kind]: { ...rules[kind], [key]: value } };
}

/** True when every kind has the same enabled flag and the same field values. */
export function sameRules(a: AttachmentRules, b: AttachmentRules): boolean {
  return KIND_ORDER.every((kind) =>
    a[kind].enabled === b[kind].enabled && FIELDS.every((f) => a[kind][f] === b[kind][f]));
}
