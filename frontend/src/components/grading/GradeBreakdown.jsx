import { formatPercentFixed } from '../../utils/format';
import GradeStatusBadge from './GradeStatusBadge';
import GradeChip from './GradeChip';

const num = (v) => (v === null || v === undefined ? '—' : Number(Number(v).toFixed(2)).toString());

/**
 * Transparent breakdown of one period grade exactly as the engine computed it:
 * component, raw score, maximum, percentage, official weight, weighted contribution.
 */
export default function GradeBreakdown({ result, title }) {
  if (!result) return null;
  const pending = !result.current;
  return (
    <section className="evsu-card p-3 p-md-4 mb-3 evsu-avoid-break" aria-label={title}>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h3 className="h6 mb-0">{title}</h3>
        <GradeStatusBadge result={result} />
      </div>
      <div className="evsu-table-wrap">
        <table className="table evsu-table mb-0">
          <caption className="visually-hidden">{title} breakdown</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col" className="text-end">Raw score</th>
              <th scope="col" className="text-end">Maximum</th>
              <th scope="col" className="text-end">Percentage</th>
              <th scope="col" className="text-end">Weight</th>
              <th scope="col" className="text-end">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {result.components.map((c) => (
              <tr key={c.key}>
                <th scope="row" data-label="Component" className="fw-semibold">
                  {c.label}
                  {c.key === 'ATTENDANCE' && c.maxScore > 0 && (
                    <span className="d-block small fw-normal text-muted-evsu">Present {c.present} · Excused {c.excused} · Absent {c.absent}</span>
                  )}
                  {c.empty && <span className="d-block small fw-normal text-muted-evsu">No items or sessions yet</span>}
                </th>
                <td data-label="Raw score" className="text-end">{num(c.rawScore)}</td>
                <td data-label="Maximum" className="text-end">{num(c.maxScore)}</td>
                <td data-label="Percentage" className="text-end">{pending ? '—' : formatPercentFixed(c.percentage)}</td>
                <td data-label="Weight" className="text-end">{c.weight}%</td>
                <td data-label="Weighted" className="text-end fw-semibold">{pending ? '—' : num(c.weightedContribution)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={5} className="text-end">Computed percentage</th>
              <td className="text-end fw-bold" data-label="Computed percentage">{pending ? '—' : formatPercentFixed(result.percentage)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={5} className="text-end">Grade equivalent</th>
              <td className="text-end" data-label="Grade">{pending ? '—' : <GradeChip grade={result.grade} />}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {result.current && result.missingItems?.length > 0 && (
        <p className="small text-danger mt-2 mb-0">
          <strong>Missing:</strong> {result.missingItems.map((m) => `${m.title} (${m.componentLabel ?? m.component})`).join(', ')}
        </p>
      )}
      {result.current && result.emptyComponents?.length > 0 && (
        <p className="small text-muted-evsu mt-2 mb-0">
          Not computable until these have items or sessions: {result.emptyComponents.map((c) => c.componentLabel).join(', ')}.
        </p>
      )}
    </section>
  );
}
