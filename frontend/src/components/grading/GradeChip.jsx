import { formatGrade } from '../../utils/format';
import { gradeBand } from '../../utils/gradeBand';

/** A 1.0–5.0 grade drawn as a chip tinted by its band. `text` overrides the label (e.g. INC). */
export default function GradeChip({ grade, text, size, className = '', ...rest }) {
  const label = text ?? (grade === null || grade === undefined ? '—' : formatGrade(grade));
  return (
    <span className={`evsu-grade ${size ? `evsu-grade--${size}` : ''} ${className}`.trim()} data-band={text ? undefined : gradeBand(grade)} {...rest}>
      {label}
    </span>
  );
}
