import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calculator, Download, Printer, RefreshCw, Share2 } from 'lucide-react';
import { useStudentGrade, useRecalculateStudent, useGradeShare } from '../../hooks/useGrading';
import { exportStudentReport } from '../../services/gradingApi';
import { useToast } from '../../components/common/Toast';
import { SEMESTER_LABELS } from '../../context/ClassContext';
import Spinner from '../../components/common/Spinner';
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

/** Individual grade report: exactly how the engine computed this student's grade. */
export default function StudentGradeReportPage() {
  const { period, studentId } = useParams();
  const [params] = useSearchParams();
  const classId = params.get('classId');
  const toast = useToast();
  const [exporting, setExporting] = useState(null);
  const { data, isPending, error, refetch } = useStudentGrade(period, classId, studentId);
  const recalc = useRecalculateStudent();
  const [calculating, setCalculating] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Only to mark the button while the student can view the sheet; the dialog shows the details.
  const shareState = useGradeShare(classId, studentId, { enabled: Boolean(data) });
  const shared = isSharing(shareState.data?.share);

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
      <PrintHeader
        title={`Individual Grade Report — ${periodLabel}`}
        lines={[`${cls.subjectCode} · ${cls.subjectTitle} · ${cls.section}`, `${SEMESTER_LABELS[cls.semester]}, SY ${cls.schoolYear}`]}
      />

      <div className="evsu-page-header no-print">
        <Link to={backLink} className="d-inline-flex align-items-center gap-1 small text-decoration-none">
          <ArrowLeft size={14} aria-hidden="true" /> Class grading sheet
        </Link>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={handleRecalculate} disabled={calculating}>
            <RefreshCw size={16} aria-hidden="true" className={calculating ? 'spin' : undefined} /> Recalculate
          </button>
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

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3 no-print">
        <nav className="evsu-segmented" aria-label="Report period">
          {GRADING_TABS.map((tab) => (
            <Link key={tab.value} to={`/grading/${tab.value}/student/${studentId}?classId=${classId}`} className="evsu-segmented__link" aria-current={tab.value === period ? 'page' : undefined}>
              {tab.label}
            </Link>
          ))}
        </nav>
        <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setSharing(true)}>
          {shared ? <span className="evsu-share-dot" aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
          {shared ? 'Shared with student' : 'Share with student'}
        </button>
      </div>
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

      {calculating ? <CalculatingPanel name={s.fullName} /> : <GradeReportBody grade={g} config={config} period={period} />}
    </>
  );
}
