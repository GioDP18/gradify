import GradeBreakdown from './GradeBreakdown';
import GradeStatusBadge from './GradeStatusBadge';
import GradeChip from './GradeChip';
import { formatPercentFixed, formatDateOnly } from '../../utils/format';

export const REPORT_PERIODS = [
  { value: 'midterm', label: 'Midterm' },
  { value: 'finals', label: 'Finals' },
  { value: 'overall', label: 'Final Grade' },
];

const STATUS_TEXT = {
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete (INC)',
  NOT_COMPUTABLE: 'Not computable yet',
  DROPPED: 'Dropped (DRP)',
  INC_LAPSED: 'INC lapsed — final grade 5.0',
};

/**
 * The figures of one student's grade for a period, exactly as the engine computed them: the
 * component breakdown (both periods and their weights for the Final Grade) and the result.
 * Shared by the instructor's report and the page a student opens from a shared link.
 */
export default function GradeReportBody({ grade: g, config, period }) {
  const periodLabel = REPORT_PERIODS.find((t) => t.value === period)?.label ?? period;
  return (
    <>
      {period === 'overall' ? (
        <>
          {['MIDTERM', 'FINALS'].map((p) => (
            <GradeBreakdown key={p} result={g.periods?.[p]} title={`${p === 'MIDTERM' ? 'Midterm' : 'Finals'} grade (${config.periodWeights[p]}% of the final grade)`} />
          ))}
          <section className="evsu-card p-3 p-md-4 mb-3 evsu-avoid-break" aria-label="Final grade computation">
            <h3 className="h6 mb-3">Final grade computation</h3>
            <div className="evsu-table-wrap">
              <table className="table evsu-table mb-0">
                <caption className="visually-hidden">Final grade computation</caption>
                <thead>
                  <tr><th scope="col">Period</th><th scope="col" className="text-end">Percentage</th><th scope="col" className="text-end">Weight</th><th scope="col" className="text-end">Weighted</th></tr>
                </thead>
                <tbody>
                  {['MIDTERM', 'FINALS'].map((p) => {
                    const pr = g.current ? g.periodResults?.[p] : null;
                    return (
                      <tr key={p}>
                        <th scope="row" data-label="Period">{p === 'MIDTERM' ? 'Midterm' : 'Finals'}</th>
                        <td data-label="Percentage" className="text-end">{formatPercentFixed(pr?.percentage)}</td>
                        <td data-label="Weight" className="text-end">{config.periodWeights[p]}%</td>
                        <td data-label="Weighted" className="text-end fw-semibold">{pr?.weightedContribution != null ? Number(pr.weightedContribution.toFixed(2)) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <GradeBreakdown result={g} title={`${periodLabel} grade`} />
      )}

      <section className="evsu-card p-3 p-md-4 evsu-avoid-break" aria-labelledby="final-result">
        <h3 id="final-result" className="h6 mb-3">{period === 'overall' ? 'Final result' : `${periodLabel} result`}</h3>
        {!g.current ? (
          <p className="mb-0"><GradeStatusBadge result={g} /> <span className="ms-2">This grade is being recalculated and will appear once it is current.</span></p>
        ) : (
          <dl className="evsu-details mb-0">
            <div><dt>Computed percentage</dt><dd className="h5 mb-0">{formatPercentFixed(g.percentage)}</dd></div>
            <div><dt>Rounded percentage</dt><dd>{g.roundedPercent === null ? '—' : `${g.roundedPercent}%`}</dd></div>
            <div><dt>Grade equivalent</dt><dd className="mb-0 mt-1"><GradeChip size="lg" grade={g.grade} /></dd></div>
            <div><dt>Remarks</dt><dd><GradeStatusBadge result={g} passingGrade={config.passingGrade} /></dd></div>
            <div><dt>Completion status</dt><dd>{STATUS_TEXT[g.completionStatus] ?? g.completionStatus}</dd></div>
            {g.incDeadline && ['INCOMPLETE', 'INC_LAPSED'].includes(g.completionStatus) && (
              <div><dt>INC completion deadline</dt><dd>{formatDateOnly(g.incDeadline.slice(0, 10))}</dd></div>
            )}
          </dl>
        )}
        {g.current && g.missingItems?.length > 0 && g.completionStatus !== 'DROPPED' && (
          <div className="mt-3">
            <p className="fw-semibold small mb-1">Lacking requirements</p>
            <ul className="small mb-0">
              {g.missingItems.map((m) => (
                <li key={`${m.period ?? ''}-${m.id}`}>{m.period ? `${m.period === 'MIDTERM' ? 'Midterm' : 'Finals'} — ` : ''}{m.title} ({m.componentLabel ?? m.component})</li>
              ))}
            </ul>
          </div>
        )}
        <p className="small text-muted-evsu mt-3 mb-0">
          Computed by the EVSU grading engine using criteria version {config.version}
          {g.lastCalculatedAt ? ` on ${new Date(g.lastCalculatedAt).toLocaleString('en-PH')}` : ''}. The percentage is rounded half-up to a whole number before conversion to the 1.0–5.0 scale.
        </p>
      </section>
    </>
  );
}
