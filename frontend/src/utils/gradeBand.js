/**
 * Colour band for a 1.0–5.0 grade (drives the grade chip tint):
 * 1 = 1.0–1.4, 2 = 1.5–1.9, 3 = 2.0–2.4, 4 = 2.5–3.0 (still passing), 5 = above 3.0 (failing).
 * Returns undefined for a missing grade (INC, DRP, not computable, pending).
 */
export function gradeBand(grade) {
  if (grade === null || grade === undefined || Number.isNaN(Number(grade))) return undefined;
  const g = Number(grade);
  if (g < 1.5) return '1';
  if (g < 2.0) return '2';
  if (g < 2.5) return '3';
  if (g <= 3.0) return '4';
  return '5';
}
