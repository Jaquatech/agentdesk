/** `created_at` is UTC text `YYYY-MM-DD HH:MM:SS`; show it in the user's local time. */
export function localTime(value: string): string {
  const date = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
