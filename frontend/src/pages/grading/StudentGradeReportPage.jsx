import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calculator, Download, Printer, RefreshCw, Share2 } from 'lucide-react';
import { useStudentGrade, useRecalculateStudent, useGradeShare } from '../../hooks/useGrading';
import { exportStudentReport } from '../../services/gradingApi';
import { useToast } from '../../components/common/Toast';
import { SEMESTER_LABELS } from '../../context/ClassContext';
import Spinner from '../../components/common/Spinner';
import Segmented from '../../components/common/Segmented';
import { ErrorState, Skeleton } from '../../components/common/States';
import GradeReportBody from '../../components/grading/GradeReportBody';
import ShareGradeDialog, { isSharing } from '../../components/grading/ShareGradeDialog';
import PrintHeader from '../../components/grading/PrintHeader';
import { GRADING_TABS } from './GradingPage';

/** Long enough to see the animation even when the server answers at once. */
const MIN_CALCULATING_MS = 900;

/** Shown in place of the figures while the engine recalculates this student. */
function CalculatingPanel({ name }) {
  return (
    <section className="evsu-card evsu-calculating" role="status" aria-live="polite">
      <span className="evsu-calculating__icon" aria-hidden="true"><Calculator size={28} /></span>
      <p className="h6 mb-1">
        Calculating {name}&rsquo;s grade
        <span className="evsu-calculating__dots" aria-hidden="true"><i /><i /><i /></span>
      </p>
      <p className="small text-muted-evsu mb-3">Reading attendance and scores, applying the official weights.</p>
      <span className="evsu-calculating__bar" aria-hidden="true" />
    </section>
  );
}

/** Midterm / Finals / Final Grade. The highlight slides to the chosen period, as on the class sheet. */
function PeriodTabs({ period, studentId, classId }) {
  return (
    <Segmented label="Report period">
      {GRADING_TABS.map((tab) => (
        <Link key={tab.value} to={`/grading/${tab.value}/student/${studentId}?classId=${classId}`} className="evsu-segmented__link" aria-current={tab.value === period ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </Segmented>
  );
}

/** Placeholder for one table card of the report: the real headings, with bars where the figures go. */
function TableSkeleton({ title, headers, rows, footRows = 0, badge = false }) {
  return (
    <section className="evsu-card p-3 p-md-4 mb-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h3 className="h6 mb-0">{title}</h3>
        {badge && <Skeleton width="5.5rem" height="1.5rem" />}
      </div>
      <div className="evsu-table-wrap">
        <table className="table evsu-table mb-0">
          <thead>
            <tr>{headers.map((h, i) => <th key={h} scope="col" className={i ? 'text-end' : undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {headers.map((h, i) => (
                  <td key={h} data-label={h} className={i ? 'text-end' : undefined}>
                    <Skeleton width={i ? '3.25rem' : `${9 + ((r * 5) % 7)}rem`} height="1.1rem" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footRows > 0 && (
            <tfoot>
              {Array.from({ length: footRows }, (_, r) => (
                <tr key={r}>
                  <td colSpan={headers.length - 1} className="text-end"><Skeleton width="9.5rem" height="1.1rem" /></td>
                  <td className="text-end"><Skeleton width="3.25rem" height="1.1rem" /></td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

const BREAKDOWN_HEADERS = ['Component', 'Raw score', 'Maximum', 'Percentage', 'Weight', 'Weighted'];

/**
 * Shown in place of the figures while a report loads. It has the report's own layout for the
 * period being opened (the Final Grade has two breakdowns and the final computation), so nothing
 * jumps when the figures arrive. The page header and period tabs stay in place above it, and so
 * does the student's card once it is known (`withStudent` false): it is the same for every period.
 */
function ReportSkeleton({ period, withStudent = true }) {
  const periodLabel = GRADING_TABS.find((t) => t.value === period)?.label ?? period;
  return (
    <div aria-busy="true">
      <span className="visually-hidden" role="status">Loading the grade report…</span>
      {withStudent && (
        <section className="evsu-card p-3 p-md-4 mb-3">
          <div className="d-flex flex-wrap justify-content-between gap-3">
            <div>
              <Skeleton width="6rem" height="0.9rem" className="d-block mb-2" />
              <Skeleton width="14rem" height="1.7rem" className="d-block mb-2" />
              <Skeleton width="11rem" height="1rem" className="d-block" />
            </div>
            <div className="d-flex flex-column align-items-md-end">
              <p className="small text-muted-evsu mb-1">Class</p>
              <Skeleton width="8rem" height="1.1rem" className="mb-1" />
              <Skeleton width="11rem" height="0.9rem" className="mb-1" />
              <Skeleton width="10rem" height="0.9rem" />
            </div>
          </div>
        </section>
      )}

      {period === 'overall' ? (
        <>
          <TableSkeleton title="Midterm grade" headers={BREAKDOWN_HEADERS} rows={4} footRows={2} badge />
          <TableSkeleton title="Finals grade" headers={BREAKDOWN_HEADERS} rows={4} footRows={2} badge />
          <TableSkeleton title="Final grade computation" headers={['Period', 'Percentage', 'Weight', 'Weighted']} rows={2} />
        </>
      ) : (
        <TableSkeleton title={`${periodLabel} grade`} headers={BREAKDOWN_HEADERS} rows={4} footRows={2} badge />
      )}

      <section className="evsu-card p-3 p-md-4">
        <h3 className="h6 mb-3">{period === 'overall' ? 'Final result' : `${periodLabel} result`}</h3>
        <dl className="evsu-details mb-0">
          {['Computed percentage', 'Rounded percentage', 'Grade equivalent', 'Remarks', 'Completion status'].map((label) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd><Skeleton width={label === 'Grade equivalent' ? '5rem' : '4.5rem'} height={label === 'Grade equivalent' ? '3.4rem' : '1.4rem'} className="mt-1" /></dd>
            </div>
          ))}
        </dl>
        <Skeleton height="0.9rem" className="mt-3" />
      </section>
    </div>
  );
}

/** Individual grade report: exactly how the engine computed this student's grade. */
export default function StudentGradeReportPage() {
  const { period, studentId } = useParams();
  const [params] = useSearchParams();
  const classId = params.get('classId');
  const toast = useToast();
  const [exporting, setExporting] = useState(null);
  const { data, isPending, isPlaceholderData, error, refetch } = useStudentGrade(period, classId, studentId);
  const recalc = useRecalculateStudent();
  const [calculating, setCalculating] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Only to mark the button while the student can view the sheet; the dialog shows the details.
  const shareState = useGradeShare(classId, studentId, { enabled: Boolean(data) });
  const shared = isSharing(shareState.data?.share);

  const backLink = `/grading${period === 'midterm' ? '' : `?period=${period}`}`;

  if (!classId) return <div className="evsu-card"><ErrorState title="No class selected" error={{ message: 'Open this report from the grading sheet.' }} /></div>;
  if (error) {
    return (
      <div className="evsu-card">
        <ErrorState title={error.status === 404 ? 'Grade report not found' : 'Could not load this report'} error={error} onRetry={error.status === 404 ? undefined : refetch} />
        <div className="text-center pb-4"><Link to={backLink}>Back to grading</Link></div>
      </div>
    );
  }

  // While a period loads, the header and tabs stay as they are and only the figures are placeholders.
  const loading = isPending || isPlaceholderData;
  // The student and class are the same for every period, so they stay on screen while another
  // period loads. (`data` may still be the previous period's report, never another student's.)
  const known = data && data.grade.student.id === studentId && data.class.id === classId ? data : null;
  const { grade: g, configuration: config, class: cls } = known ?? {};
  const s = g?.student;
  const periodLabel = GRADING_TABS.find((t) => t.value === period)?.label ?? period;

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      // The mutation resolves after the report has reloaded, so the new figures are ready when the animation ends.
      await Promise.all([recalc.mutateAsync({ classId, studentId }), new Promise((resolve) => { setTimeout(resolve, MIN_CALCULATING_MS); })]);
      toast.success(`Recalculated ${s.fullName}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCalculating(false);
    }
  };

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
      {known && !loading && (
        <PrintHeader
          title={`Individual Grade Report — ${periodLabel}`}
          lines={[`${cls.subjectCode} · ${cls.subjectTitle} · ${cls.section}`, `${SEMESTER_LABELS[cls.semester]}, SY ${cls.schoolYear}`]}
        />
      )}

      <div className="evsu-page-header no-print">
        <Link to={backLink} className="d-inline-flex align-items-center gap-1 small text-decoration-none">
          <ArrowLeft size={14} aria-hidden="true" /> Class grading sheet
        </Link>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={handleRecalculate} disabled={calculating || loading}>
            <RefreshCw size={16} aria-hidden="true" className={calculating ? 'spin' : undefined} /> Recalculate
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => handleExport('csv')} disabled={Boolean(exporting) || loading}>
            {exporting === 'csv' ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} CSV
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => handleExport('xlsx')} disabled={Boolean(exporting) || loading}>
            {exporting === 'xlsx' ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} Excel
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => window.print()} disabled={loading}>
            <Printer size={16} aria-hidden="true" /> Print report
          </button>
        </div>
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3 no-print">
        <PeriodTabs period={period} studentId={studentId} classId={classId} />
        <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setSharing(true)} disabled={!known}>
          {shared ? <span className="evsu-share-dot" aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
          {shared ? 'Shared with student' : 'Share with student'}
        </button>
      </div>
      {!known ? <ReportSkeleton period={period} /> : (
        <>
          <ShareGradeDialog open={sharing} onClose={() => setSharing(false)} classId={classId} studentId={studentId} studentName={s.fullName} />

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

          {loading && <ReportSkeleton period={period} withStudent={false} />}
          {!loading && (calculating ? <CalculatingPanel name={s.fullName} /> : <GradeReportBody grade={g} config={config} period={period} />)}
        </>
      )}
    </>
  );
}
