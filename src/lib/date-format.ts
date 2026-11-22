const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Format archive dates identically during server rendering and browser
 * hydration. Explicit UTC components avoid locale and local-time differences.
 */
export function formatArchiveDate(value: string | Date, includeYear = false): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  return includeYear
    ? `${day} ${month} ${date.getUTCFullYear()}`
    : `${day} ${month}`;
}


/**
 * Include the archive's canonical UTC time so timestamps remain clear and
 * stable regardless of the server or browser's local timezone.
 */
export function formatArchiveDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}
