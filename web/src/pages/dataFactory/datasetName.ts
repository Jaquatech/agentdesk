/**
 * The name field after a file is picked: a file name fills it in unless the user typed a name
 * since the last import or pick, in which case the typed name stays.
 */
export function nextName(typed: boolean, current: string, fileName: string): string {
  return typed ? current : fileName.replace(/\.[^.]+$/, "");
}
