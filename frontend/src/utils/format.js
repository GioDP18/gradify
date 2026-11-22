/**
 * Display formatting only. These never feed back into any grade computation —
 * official values (and their rounding) come from the backend grading engine.
 */
export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const fixed = Number(value).toFixed(digits);
  return `${fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed}%`;
}

/** Official grades are stored with one decimal by the engine; show them as "2.1", "1.0". */
export function formatGrade(value) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(1);
}

/** Percentages from the engine are full precision; display with 2 decimals. */
export function formatPercentFixed(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`;
}

/** "2026-09-01" → "Tue, Sep 1, 2026" (calendar date, no time-zone shift). */
export function formatDateOnly(value, options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '—';
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-PH', { ...options, timeZone: 'UTC' });
}

/** Today's date in Philippine time as "YYYY-MM-DD". */
export function todayDateOnly() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
