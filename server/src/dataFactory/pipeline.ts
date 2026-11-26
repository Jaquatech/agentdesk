/**
 * Approval of dataset versions: a local sensitive-data check, replacement of what it finds, and the removal of the
 * original text. Nothing here calls a model. Placeholder-to-value pairs are never stored.
 */
import { rmSync } from "node:fs";
import type { DB } from "../db.ts";
import { sha256 } from "../crypto.ts";
import { anonymizeCases, scanCases, type CaseLike, type Finding } from "./anonymize.ts";
import { versionFilePath, writeVersionFile, type DatasetVersion } from "./datasets.ts";
import { SENSITIVE_KINDS, type SensitiveKind, type SensitiveTerms } from "./sensitive.ts";

export const UNAPPROVED_MESSAGE = "Approve this dataset version on the Datasets tab before running it.";

export const MAX_TERM_ENTRIES = 500;
export const MAX_TERM_CHARS = 200;
const MAX_FINDINGS = 500;
const PREVIEW_CASES = 50;

type CaseRow = { case_key: string; input: string; expected: string | null; tags: string; meta: string };
type VersionRow = DatasetVersion & { project_id: number };
type CaseView = { case_key: string; input: string; expected: string | null; tags: string[]; meta: Record<string, unknown> };

// ---- own names and terms ----

/** Trims, drops empty lines and duplicates. A string is returned when the list breaks a limit. */
export function cleanTermList(value: unknown, label: string): string[] | string {
  if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) return `${label} must be a list of text lines`;
  const out = [...new Set((value as string[]).map((x) => x.trim()).filter((x) => x !== ""))];
  if (out.length > MAX_TERM_ENTRIES) return `${label} can have up to ${MAX_TERM_ENTRIES} entries`;
  if (out.some((x) => x.length > MAX_TERM_CHARS)) return `Each entry in ${label} can be up to ${MAX_TERM_CHARS} characters`;
  return out;
}

export function readTerms(db: DB, projectId: number): SensitiveTerms {
  const row = db.prepare("SELECT sensitive_terms FROM projects WHERE id = ?").get(projectId) as { sensitive_terms: string } | undefined;
  const empty: SensitiveTerms = { people: [], terms: [] };
  if (!row || row.sensitive_terms === "") return empty;
  try {
    const parsed = JSON.parse(row.sensitive_terms) as Partial<SensitiveTerms>;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return { people: list(parsed.people), terms: list(parsed.terms) };
  } catch {
    return empty;
  }
}

export function writeTerms(db: DB, projectId: number, terms: SensitiveTerms): void {
  db.prepare("UPDATE projects SET sensitive_terms = ? WHERE id = ?").run(JSON.stringify(terms), projectId);
}

// ---- reading ----

export function versionRow(db: DB, versionId: number): VersionRow | undefined {
  return db
    .prepare("SELECT v.*, d.project_id FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.id = ?")
    .get(versionId) as VersionRow | undefined;
}

export function versionRunCount(db: DB, versionId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM eval_runs WHERE version_id = ?").get(versionId) as { n: number }).n;
}

export function isApproved(db: DB, versionId: number): boolean {
  const r = db.prepare("SELECT approved_at FROM eval_dataset_versions WHERE id = ?").get(versionId) as { approved_at: string | null } | undefined;
  return !!r?.approved_at;
}

function loadCases(db: DB, versionId: number): CaseLike[] {
  const rows = db.prepare("SELECT case_key, input, expected, tags, meta FROM eval_cases WHERE version_id = ? ORDER BY position").all(versionId) as CaseRow[];
  return rows.map((r) => ({ id: r.case_key, input: r.input, expected: r.expected, tags: JSON.parse(r.tags) as string[], meta: JSON.parse(r.meta) as Record<string, unknown> }));
}

const view = (c: CaseLike): CaseView => ({ case_key: c.id, input: c.input, expected: c.expected ?? null, tags: c.tags, meta: c.meta });

// ---- options ----

export type PipelineOptions = { disabledKeys: string[]; disabledKinds: SensitiveKind[] };

/** Reads `disabled_keys` and `disabled_kinds` from a body; a string is returned when they are wrong. */
export function readOptions(b: Record<string, unknown>): PipelineOptions | string {
  const keys = b.disabled_keys ?? [];
  const kinds = b.disabled_kinds ?? [];
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) return "disabled_keys must be a list of text";
  if (!Array.isArray(kinds) || !kinds.every((k): k is SensitiveKind => (SENSITIVE_KINDS as readonly unknown[]).includes(k))) return "disabled_kinds must be a list of known kinds";
  return { disabledKeys: keys as string[], disabledKinds: kinds as SensitiveKind[] };
}

// ---- check ----

export type CheckResult = {
  total_cases: number;
  changed_cases: number;
  finding_count: number;
  findings: Finding[];
  counts: Partial<Record<SensitiveKind, number>>;
  preview: { case_key: string; before: CaseView; after: CaseView }[];
};

/** What approval would replace. Changes nothing. */
export function checkVersion(db: DB, version: VersionRow, options: PipelineOptions, offset: number): CheckResult {
  const cases = loadCases(db, version.id);
  const terms = readTerms(db, version.project_id);
  const findings = scanCases(cases, terms);
  const result = anonymizeCases(cases, terms, { disabledKeys: options.disabledKeys, disabledKinds: options.disabledKinds });
  const preview = result.changed.slice(offset, offset + PREVIEW_CASES).map((i) => ({
    case_key: cases[i].id,
    before: view(cases[i]),
    after: view(result.cases[i]),
  }));
  return {
    total_cases: cases.length,
    changed_cases: result.changed.length,
    finding_count: findings.length,
    findings: findings.slice(0, MAX_FINDINGS),
    counts: result.counts,
    preview,
  };
}

// ---- secure removal ----

/** Runs fn with secure_delete on, so deleted text is overwritten in the database file, then truncates the WAL. */
export function secureDelete<T>(db: DB, fn: () => T): T {
  const before = db.prepare("PRAGMA secure_delete").get() as { secure_delete: number } | undefined;
  db.pragma("secure_delete = ON");
  try {
    return fn();
  } finally {
    db.pragma(`secure_delete = ${before?.secure_delete ? "ON" : "OFF"}`);
    db.pragma("wal_checkpoint(TRUNCATE)");
  }
}

function removeVersionRows(db: DB, versionId: number): void {
  db.prepare("DELETE FROM eval_cases WHERE version_id = ?").run(versionId);
  db.prepare("DELETE FROM eval_dataset_versions WHERE id = ?").run(versionId);
}

function removeVersionFile(dataDir: string, v: DatasetVersion): void {
  rmSync(versionFilePath(dataDir, v.dataset_id, v.version, v.format), { force: true });
}

export type DeleteVersionResult = { ok: true } | { ok: false; status: number; error: string };

export function deleteVersion(db: DB, dataDir: string, version: VersionRow): DeleteVersionResult {
  const runs = versionRunCount(db, version.id);
  if (runs > 0) return { ok: false, status: 409, error: `This version is used by ${runs} runs. Delete those runs first.` };
  const count = (db.prepare("SELECT COUNT(*) AS n FROM eval_dataset_versions WHERE dataset_id = ?").get(version.dataset_id) as { n: number }).n;
  if (count <= 1) return { ok: false, status: 409, error: "This is the only version of the dataset. Delete the dataset instead." };
  secureDelete(db, () => db.transaction(() => removeVersionRows(db, version.id))());
  removeVersionFile(dataDir, version);
  return { ok: true };
}

// ---- approve ----

export type ApproveResult =
  | { ok: false; status: number; error: string }
  | { ok: true; version: DatasetVersion; original_deleted: boolean; kept_reason: string | null };

function jsonl(cases: CaseLike[]): string {
  return cases
    .map((c) => {
      const line: Record<string, unknown> = { ...c.meta, id: c.id, input: c.input, tags: c.tags };
      if (typeof c.expected === "string") line.expected = c.expected;
      return JSON.stringify(line);
    })
    .join("\n");
}

export function approveVersion(
  db: DB,
  dataDir: string,
  version: VersionRow,
  options: PipelineOptions & { deleteOriginal: boolean },
): ApproveResult {
  if (version.approved_at) return { ok: false, status: 409, error: "This version is already approved." };
  const cases = loadCases(db, version.id);
  const result = anonymizeCases(cases, readTerms(db, version.project_id), { disabledKeys: options.disabledKeys, disabledKinds: options.disabledKinds });

  if (result.changed.length === 0) {
    db.prepare("UPDATE eval_dataset_versions SET approved_at = datetime('now') WHERE id = ?").run(version.id);
    return { ok: true, version: versionRow(db, version.id) as VersionRow, original_deleted: false, kept_reason: null };
  }

  const text = jsonl(result.cases);
  const runs = versionRunCount(db, version.id);
  const deleteSource = options.deleteOriginal && runs === 0;
  const stored = secureDelete(db, () =>
    db.transaction(() => {
      const max = db.prepare("SELECT MAX(version) AS v FROM eval_dataset_versions WHERE dataset_id = ?").get(version.dataset_id) as { v: number };
      const next = max.v + 1;
      const info = db
        .prepare(`INSERT INTO eval_dataset_versions (dataset_id, version, format, sha256, case_count, note, source_name, approved_at, cleaned_from, cleaned_counts)
          VALUES (?, ?, 'jsonl', ?, ?, ?, '', datetime('now'), ?, ?)`)
        .run(version.dataset_id, next, sha256(text), result.cases.length, `Anonymized from v${version.version}`, version.version, JSON.stringify(result.counts));
      const id = Number(info.lastInsertRowid);
      const ins = db.prepare("INSERT INTO eval_cases (version_id, case_key, input, expected, tags, meta, position) VALUES (?, ?, ?, ?, ?, ?, ?)");
      result.cases.forEach((c, i) => ins.run(id, c.id, c.input, c.expected ?? null, JSON.stringify(c.tags), JSON.stringify(c.meta), i));
      if (deleteSource) removeVersionRows(db, version.id);
      return { id, next };
    })(),
  );
  writeVersionFile(dataDir, version.dataset_id, stored.next, "jsonl", text);
  if (deleteSource) removeVersionFile(dataDir, version);

  const created = db.prepare("SELECT * FROM eval_dataset_versions WHERE id = ?").get(stored.id) as DatasetVersion;
  let keptReason: string | null = null;
  if (options.deleteOriginal && !deleteSource) keptReason = `The original version is kept because ${runs} runs use it.`;
  return { ok: true, version: created, original_deleted: deleteSource, kept_reason: keptReason };
}
