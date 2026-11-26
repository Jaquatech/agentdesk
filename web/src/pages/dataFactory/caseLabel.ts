/** Heading for a case: an importer-made id `case-3` reads "Case 3", any other id "Case <id>". */
export function caseLabel(key: string): string {
  const m = /^case-(\d+)$/.exec(key);
  return `Case ${m ? m[1] : key}`;
}
