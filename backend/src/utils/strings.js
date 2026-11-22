/** Escapes user text for safe use inside a RegExp (prevents ReDoS / regex injection). */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapses runs of whitespace and trims. */
export function squish(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}
