import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useStudentGrade } from '../../hooks/useGrading';
import { exportStudentReport } from '../../services/gradingApi';
import { useToast } from '../../components/common/Toast';
import { SEMESTER_LABELS } from '../../context/ClassContext';
import Spinner from '../../components/common/Spinner';
import { ErrorState, Skeleton } from '../../components/common/States';
import GradeBreakdown from '../../components/grading/GradeBreakdown';
import GradeStatusBadge from '../../components/grading/GradeStatusBadge';
import GradeChip from '../../components/grading/GradeChip';
import PrintHeader from '../../components/grading/PrintHeader';
import { formatPercentFixed, formatDateOnly } from '../../utils/format';
import { GRADING_TABS } from './GradingPage';

const STATUS_TEXT = {
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete (INC)',
  NOT_COMPUTABLE: 'Not computable yet',
  DROPPED: 'Dropped (DRP)',
  INC_LAPSED: 'INC lapsed — final grade 5.0',
};

/** Individual grade report: exactly how the engine computed this student's grade. */
export default function StudentGradeReportPage() {
  const { period, studentId } = useParams();
  const [params] = useSearchParams();
  const classId = params.get('classId');
  const toast = useToast();
  const [exporting, setExporting] = useState(null);
  const { data, isPending, error, refetch } = useStudentGrade(period, classId, studentId);

  const backLink = `/grading${period === 'midterm' ? '' : `?period=${period}`}`;

  if (!classId) return <div className="evsu-card"><ErrorState title="No class selected" error={{ message: 'Open this report from the grading sheet.' }} /></div>;
  if (isPending) {
    return (
      <div className="evsu-card p-4" aria-busy="true">
        <Skeleton width="40%" height="1.5rem" />
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mt-3" height="2rem" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="evsu-card">
        <ErrorState title={error.status === 404 ? 'Grade report not found' : 'Could not load this report'} error={error} onRetry={error.status === 404 ? undefined : refetch} />
        <div className="text-center pb-4"><Link to={backLink}>Back to grading</Link></div>
      </div>
    );
  }

  const { grade: g, configuration: config, class: cls } = data;
  const s = g.student;
  const periodLabel = GRADING_TABS.find((t) => t.value === period)?.label ?? period;

  const handleExport = async (format) => {
    setExporting(format);
    try {
      await exportStudentReport(period, classId, studentId, format);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PrintHeader
        title={`Individual Grade Report — ${periodLabel}`}
        lines={[`${cls.subjectCode} · ${cls.subjectTitle} · ${cls.section}`, `${SEMESTER_LABELS[cls.semester]}, SY ${cls.schoolYear}`]}
      />

      <div className="evsu-page-header no-print">
        <Link to={backLink} className="d-inline-flex align-items-center gap-1 small text-decoration-none">
          <ArrowLeft size={14} aria-hidden="true" /> Class grading sheet
        </Link>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => handleExport('csv')} disabled={Boolean(exporting)}>
            {exporting === 'csv' ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} CSV
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => handleExport('xlsx')} disabled={Boolean(exporting)}>
            {exporting === 'xlsx' ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} Excel
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" /> Print report
          </button>
        </div>
      </div>

      <nav className="evsu-segmented mb-3 no-print" aria-label="Report period">
        {GRADING_TABS.map((tab) => (
          <Link key={tab.value} to={`/grading/${tab.value}/student/${studentId}?classId=${classId}`} className="evsu-segmented__link" aria-current={tab.value === period ? 'page' : undefined}>
            {tab.label}
          </Link>
        ))}
      </nav>

      <section className="evsu-card p-3 p-md-4 mb-3 evsu-avoid-break" aria-labelledby="report-student">
        <div className="d-flex flex-wrap justify-content-between gap-3">
          <div>
            <p className="small text-muted-evsu mb-1">{s.studentNumber}</p>
            <h2 id="report-student" className="h4 mb-1">{s.fullName}</h2>
            <p className="mb-0 text-muted-evsu">{s.course} · Year {s.yearLevel} · Section {s.section}</p>
          </div>
          <div className="text-md-end">
            <p className="small text-muted-evsu mb-1">Class</p>
            <p className="fw-semibold mb-0">{cls.subjectCode} · {cls.section}</p>
            <p className="small mb-0">{cls.subjectTitle}</p>
            <p className="small text-muted-evsu mb-0">{SEMESTER_LABELS[cls.semester]}, SY {cls.schoolYear}</p>
          </div>
        </div>
      </section>

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
