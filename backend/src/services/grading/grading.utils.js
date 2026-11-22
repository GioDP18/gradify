/**
 * Decimal-safe numeric helpers for the grading engine.
 *
 * Binary floating point cannot represent most decimals exactly (0.1 + 0.2 = 0.30000000000000004).
 * Grades sit on hard boundaries (74.5% passes, 74.4% does not), so a value that should be 74.5
 * must never become 74.49999999. We shift decimal exponents via strings (exact) and strip
 * float noise below 1e-9 before the final rounding step.
 */

/** Multiplies n by 10^exp exactly using the decimal exponent (no float multiplication). */
function shiftDecimal(n, exp) {
  const [mantissa, e = '0'] = String(n).split('e');
  return Number(`${mantissa}e${Number(e) + exp}`);
}

/** Round half up (away from zero for .5) to `decimals` places. */
export function roundHalfUp(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const sign = value < 0 ? -1 : 1;
  return sign * shiftDecimal(Math.round(shiftDecimal(Math.abs(value), decimals)), -decimals);
}

/** Removes binary floating-point noise (e.g. 74.49999999999999 → 74.5) without changing real precision. */
export function stripFloatNoise(value) {
  if (value === null || value === undefined) return value;
  return Number(value.toFixed(9));
}

/** Sum of numbers, computed on scaled integers to avoid accumulation drift (supports up to 6 decimals). */
export function preciseSum(values) {
  const SCALE = 1e6;
  return values.reduce((acc, v) => acc + Math.round(v * SCALE), 0) / SCALE;
}

/** Number of decimal places in a number as written (0.25 → 2). */
export function decimalPlaces(value) {
  const text = String(value);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Adds months to a date (used for INC compliance deadlines). */
export function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
