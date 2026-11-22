const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-20" → Date at 00:00 UTC, or null if not a real calendar date. */
export function parseDateOnly(value) {
  const match = DATE_ONLY.exec(String(value ?? ''));
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/** Date → "YYYY-MM-DD" (UTC calendar date). */
export function formatDateOnly(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null;
}

/** Today's calendar date in the given IANA time zone, as "YYYY-MM-DD". */
export function todayInTimeZone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
