import { formatGrade } from '../../utils/format';

/**
 * Status/remarks pill for an engine result. Never shows a grade that is not current.
 */
export default function GradeStatusBadge({ result, passingGrade = 3.0 }) {
  if (!result) return null;
  if (!result.current) {
    return (
      <span className="evsu-status evsu-status--warn" title={result.calcStatus === 'FAILED' ? 'Recalculation failed; it will be retried automatically.' : 'Recalculating…'}>
        {result.calcStatus === 'FAILED' ? 'Pending (retrying)' : 'Pending'}
      </span>
    );
  }
  switch (result.completionStatus) {
    case 'INCOMPLETE':
      return <span className="evsu-status evsu-status--error" title="Incomplete: missing requirements">INC</span>;
    case 'DROPPED':
      return <span className="evsu-status evsu-status--warn" title="Dropped">DRP</span>;
    case 'NOT_COMPUTABLE':
      return <span className="evsu-status evsu-status--neutral" title="A grading component has no items or sessions yet">Not computable</span>;
    case 'INC_LAPSED':
      return <span className="evsu-status evsu-status--error" title="INC not completed within the compliance period">{formatGrade(result.grade)} · INC lapsed</span>;
    default: {
      const tone = result.grade <= passingGrade ? 'ok' : result.grade <= 4.0 ? 'warn' : 'error';
      return <span className={`evsu-status evsu-status--${tone}`}>{result.remarks}</span>;
    }
  }
}
