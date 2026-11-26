const DB_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** UTC text, either the database form `YYYY-MM-DD HH:MM:SS` or ISO `...T...Z`, in the user's local time. Other text is returned unchanged. */
export function localTime(value: string): string {
  const iso = DB_TIME.test(value) ? `${value.replace(" ", "T")}Z` : ISO_TIME.test(value) ? value : null;
  if (iso === null) return value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
