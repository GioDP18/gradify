import { useId } from 'react';
import { Check, X, Clock } from 'lucide-react';

export const ATTENDANCE_STATUSES = [
  { value: 'PRESENT', label: 'Present', short: 'P', icon: Check },
  { value: 'ABSENT', label: 'Absent', short: 'A', icon: X },
  { value: 'EXCUSED', label: 'Excused', short: 'E', icon: Clock },
];

/**
 * Present / Absent / Excused as a native radio group (arrow keys move between options).
 */
export default function AttendanceStatusToggle({ value, onChange, studentName, disabled = false }) {
  const name = useId();
  return (
    <div className="evsu-att-toggle" role="radiogroup" aria-label={`Attendance for ${studentName}`}>
      {ATTENDANCE_STATUSES.map(({ value: option, label, short, icon: Icon }) => {
        const id = `${name}-${option}`;
        return (
          <span key={option}>
            <input
              type="radio"
              id={id}
              name={name}
              className="visually-hidden"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              disabled={disabled}
              aria-label={label}
            />
            {/* Visible text adapts to screen width; the accessible name is always the full word (aria-label above). */}
            <label htmlFor={id} className={`evsu-att-toggle__opt evsu-att-toggle__opt--${option.toLowerCase()}`} title={label}>
              <Icon size={14} aria-hidden="true" />
              <span className="d-none d-xl-inline" aria-hidden="true">{label}</span>
              <span className="d-xl-none" aria-hidden="true">{short}</span>
            </label>
          </span>
        );
      })}
    </div>
  );
}
