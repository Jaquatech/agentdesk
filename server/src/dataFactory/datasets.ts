import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "../db.ts";
import { sha256 } from "../crypto.ts";
import { datasetWarnings, parseDataset, type DatasetFormat, type DatasetProblem } from "./datasetParser.ts";

export type DatasetVersion = {
  id: number;
  dataset_id: number;
  version: number;
  format: string;
  sha256: string;
  case_count: number;
  note: string;
  source_name: string;
  created_at: string;
};

export type ImportResult =
  | { ok: false; problems: DatasetProblem[]; warnings: string[] }
  | { ok: true; datasetId: number; version: DatasetVersion; unchanged: boolean; warnings: string[] };

export function datasetDir(dataDir: string, datasetId: number): string {
  return join(dataDir, "evals", "datasets", String(datasetId));
}

/** Parse and store one upload. Nothing is stored when the file has problems. Versions are only ever added. */
export function importDataset(
  db: DB,
  dataDir: string,
  input: { projectId: number; name: string; format: DatasetFormat; text: string; note?: string; sourceName?: string },
): ImportResult {
  const { cases, problems } = parseDataset(input.text, input.format);
  const warnings = datasetWarnings(cases);
  if (problems.length > 0) return { ok: false, problems, warnings };

  const hash = sha256(input.text);
  const existing = db
    .prepare("SELECT id FROM eval_datasets WHERE project_id = ? AND name = ?")
    .get(input.projectId, input.name) as { id: number } | undefined;
  if (existing) {
    const latest = db
      .prepare("SELECT * FROM eval_dataset_versions WHERE dataset_id = ? ORDER BY version DESC LIMIT 1")
      .get(existing.id) as DatasetVersion | undefined;
    if (latest && latest.sha256 === hash) return { ok: true, datasetId: existing.id, version: latest, unchanged: true, warnings };
  }

  const stored = db.transaction(() => {
    let datasetId = existing?.id;
    let version = 1;
    if (datasetId === undefined) {
      const info = db.prepare("INSERT INTO eval_datasets (project_id, name) VALUES (?, ?)").run(input.projectId, input.name);
      datasetId = Number(info.lastInsertRowid);
    } else {
      const max = db.prepare("SELECT MAX(version) AS v FROM eval_dataset_versions WHERE dataset_id = ?").get(datasetId) as { v: number | null };
      version = (max.v ?? 0) + 1;
    }
    const info = db
      .prepare("INSERT INTO eval_dataset_versions (dataset_id, version, format, sha256, case_count, note, source_name) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(datasetId, version, input.format, hash, cases.length, input.note ?? "", input.sourceName ?? "");
    const versionId = Number(info.lastInsertRowid);
    const ins = db.prepare(
      "INSERT INTO eval_cases (version_id, case_key, input, expected, tags, meta, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    cases.forEach((c, i) => ins.run(versionId, c.id, c.input, c.expected ?? null, JSON.stringify(c.tags), JSON.stringify(c.meta), i));
    return { datasetId, version, versionId };
  })();

  const dir = datasetDir(dataDir, stored.datasetId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `v${stored.version}.${input.format}`), input.text, "utf8");

  const row = db.prepare("SELECT * FROM eval_dataset_versions WHERE id = ?").get(stored.versionId) as DatasetVersion;
  return { ok: true, datasetId: stored.datasetId, version: row, unchanged: false, warnings };
}

/** Number of runs that use a version of this dataset. */
export function datasetRunCount(db: DB, datasetId: number): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM eval_runs r JOIN eval_dataset_versions v ON v.id = r.version_id WHERE v.dataset_id = ?`).get(datasetId) as { n: number };
  return r.n;
}

/** Thrown by deleteDataset while runs still use the dataset; the route turns it into 409. */
export class DatasetInUseError extends Error {
  constructor(readonly runs: number) {
    super(`This dataset is used by ${runs} runs. Delete those runs first.`);
    this.name = "DatasetInUseError";
  }
}

/** Removes the dataset, all its versions and cases (cascade) and the stored original files. */
export function deleteDataset(db: DB, dataDir: string, datasetId: number): void {
  const used = datasetRunCount(db, datasetId);
  if (used > 0) throw new DatasetInUseError(used);
  db.prepare("DELETE FROM eval_datasets WHERE id = ?").run(datasetId);
  rmSync(datasetDir(dataDir, datasetId), { recursive: true, force: true });
}
