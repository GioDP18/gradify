export const GRADING_PERIODS = [
  { value: 'MIDTERM', label: 'Midterm' },
  { value: 'FINALS', label: 'Finals' },
];

export const periodLabel = (value) => GRADING_PERIODS.find((p) => p.value === value)?.label ?? value;

/** Midterm / Finals switch used by every period-separated module. */
export default function GradingPeriodSelector({ value, onChange, label = 'Grading period' }) {
  return (
    <div className="evsu-segmented" role="group" aria-label={label}>
      {GRADING_PERIODS.map((period) => (
        <button key={period.value} type="button" aria-pressed={value === period.value} onClick={() => onChange(period.value)}>
          {period.label}
        </button>
      ))}
    </div>
  );
}
