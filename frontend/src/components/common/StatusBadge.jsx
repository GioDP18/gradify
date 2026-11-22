const TONES = {
  ACTIVE: 'ok',
  ARCHIVED: 'neutral',
  ENROLLED: 'ok',
  DROPPED: 'warn',
  INACTIVE: 'neutral',
  DRP: 'warn',
};

const LABELS = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
  ENROLLED: 'Enrolled',
  DROPPED: 'Dropped',
  INACTIVE: 'Inactive',
  DRP: 'DRP',
};

/** Small coloured pill for record states. Unknown values render in a neutral tone. */
export default function StatusBadge({ status, label, tone }) {
  const resolvedTone = tone ?? TONES[status] ?? 'neutral';
  return <span className={`evsu-status evsu-status--${resolvedTone}`}>{label ?? LABELS[status] ?? status}</span>;
}
