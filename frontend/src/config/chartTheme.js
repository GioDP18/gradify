/** Shared chart colours (Recharts needs literal values; these mirror styles/tokens.css). */
export const CHART = {
  maroon: '#8a1c22',
  gold: '#d48f0c',
  grid: '#ebe7ee',
  tick: { fontSize: 11, fill: '#615b69' },
};

/** Bar fill per grade-distribution bucket — same ramp as the grade chips (all ≥ 3:1 on white). */
const BUCKET_FILL = {
  '1.0–1.4': '#2f8a52',
  '1.5–1.9': '#5f8f22',
  '2.0–2.4': '#a8860f',
  '2.5–2.9': '#c87412',
  '3.0': '#c87412',
  '3.1–4.0': '#c7442f',
  '4.1–5.0': '#a3261b',
};
export const bucketFill = (label) => BUCKET_FILL[label] ?? '#8f8798';
