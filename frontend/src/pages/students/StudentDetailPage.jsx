import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Pencil, UserMinus, UserPlus } from 'lucide-react';
import { useStudent, useUpdateStudent, useArchiveStudent, useRestoreStudent, useSetEnrollmentStatus, useEnrollStudents } from '../../hooks/useStudents';
import { useClassContext, formatClassLabel, SEMESTER_LABELS } from '../../context/ClassContext';
import { useToast } from '../../components/common/Toast';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Spinner from '../../components/common/Spinner';
import ActionButton from '../../components/common/ActionButton';
import { ErrorState, Skeleton, EmptyState } from '../../components/common/States';
import StudentFormModal from '../../components/students/StudentFormModal';
import DropEnrollmentDialog from '../../components/students/DropEnrollmentDialog';
import { useAttendanceSummary } from '../../hooks/useAttendance';
import { periodLabel } from '../../components/common/GradingPeriodSelector';
import { formatPercent } from '../../utils/format';
import { useStudentGradesAcrossClasses } from '../../hooks/useGrading';
import GradeStatusBadge from '../../components/grading/GradeStatusBadge';
import GradeChip from '../../components/grading/GradeChip';

/** Midterm, Finals, and final grades per class — read from the grading engine. */
function StudentGrades({ studentId }) {
  const { data, isPending, error } = useStudentGradesAcrossClasses(studentId);
  const cell = (result) => {
    if (!result) return '—';
    if (!result.current) return <GradeStatusBadge result={result} />;
    return (
      <span className="d-inline-flex flex-column align-items-end gap-1">
        {result.grade !== null && <GradeChip size="sm" grade={result.grade} />}
        <GradeStatusBadge result={result} />
      </span>
    );
  };
  return (
    <section className="evsu-card p-4 mt-4" aria-labelledby="grades-heading">
      <h3 id="grades-heading" className="h6 mb-3">Grades</h3>
      {isPending && <Skeleton width="60%" />}
      {error && <p className="text-danger small mb-0">{error.message}</p>}
      {data && data.length === 0 && <p className="text-muted-evsu small mb-0">No grades yet — enroll this student in a class.</p>}
      {data && data.length > 0 && (
        <div className="evsu-table-wrap">
          <table className="table evsu-table mb-0">
            <caption className="visually-hidden">Grades by class</caption>
            <thead>
              <tr><th scope="col">Class</th><th scope="col" className="text-end">Midterm</th><th scope="col" className="text-end">Finals</th><th scope="col" className="text-end">Final grade</th><th scope="col"><span className="visually-hidden">Report</span></th></tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.classId}>
                  <td data-label="Class">{row.subjectCode} · {row.section}<span className="d-block small text-muted-evsu">SY {row.schoolYear}</span></td>
                  <td data-label="Midterm" className="text-end">{cell(row.grades.MIDTERM)}</td>
                  <td data-label="Finals" className="text-end">{cell(row.grades.FINALS)}</td>
                  <td data-label="Final grade" className="text-end">{cell(row.grades.OVERALL)}</td>
                  <td className="text-end"><Link to={`/grading/overall/student/${studentId}?classId=${row.classId}`} className="btn btn-sm btn-outline-primary">Report</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Attendance per class and grading period, from actual records. */
function StudentAttendance({ studentId, enrollments }) {
  const { data, isPending, error } = useAttendanceSummary({ studentId });
  const classLabel = (classId) => {
    const e = enrollments.find((x) => x.classId === classId);
    return e ? `${e.subjectCode} · ${e.section}` : 'Class';
  };
  return (
    <section className="evsu-card p-4 mt-4" aria-labelledby="attendance-heading">
      <h3 id="attendance-heading" className="h6 mb-3">Attendance</h3>
      {isPending && <Skeleton width="60%" />}
      {error && <p className="text-danger small mb-0">{error.message}</p>}
      {data && data.students.length === 0 && <p className="text-muted-evsu small mb-0">No attendance recorded yet.</p>}
      {data && data.students.length > 0 && (
        <div className="evsu-table-wrap">
          <table className="table evsu-table mb-0">
            <caption className="visually-hidden">Attendance by class and grading period</caption>
            <thead>
              <tr>
                <th scope="col">Class</th><th scope="col">Period</th><th scope="col" className="text-end">Present</th>
                <th scope="col" className="text-end">Absent</th><th scope="col" className="text-end">Excused</th>
                <th scope="col" className="text-end">Sessions</th><th scope="col" className="text-end">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((row) => (
                <tr key={`${row.classId}-${row.period}`}>
                  <td data-label="Class">{classLabel(row.classId)}</td>
                  <td data-label="Period">{periodLabel(row.period)}</td>
                  <td data-label="Present" className="text-end">{row.present}</td>
                  <td data-label="Absent" className="text-end">{row.absent}</td>
                  <td data-label="Excused" className="text-end">{row.excused}</td>
                  <td data-label="Sessions" className="text-end">{row.total}</td>
                  <td data-label="Attendance" className="text-end fw-semibold">{formatPercent(row.attendanceRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export default function StudentDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { activeClasses } = useClassContext();
  const { data: student, isPending, error, refetch } = useStudent(id);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const [enrollClassId, setEnrollClassId] = useState('');

  const updateStudent = useUpdateStudent();
  const archiveStudent = useArchiveStudent();
  const restoreStudent = useRestoreStudent();
  const setEnrollment = useSetEnrollmentStatus();
  const enrollStudents = useEnrollStudents();

  if (isPending) {
    return (
      <div className="evsu-card p-4" aria-busy="true">
        <Skeleton width="30%" height="1.5rem" />
        <Skeleton width="60%" className="mt-3" />
        <Skeleton width="50%" className="mt-2" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="evsu-card">
        <ErrorState title={error.status === 404 ? 'Student not found' : 'Could not load this student'} error={error} onRetry={error.status === 404 ? undefined : refetch} />
        <div className="text-center pb-4"><Link to="/students">Back to students</Link></div>
      </div>
    );
  }

  const archived = Boolean(student.archivedAt);
  const enrolledClassIds = new Set(student.enrollments.map((e) => e.classId));
  const enrollableClasses = activeClasses.filter((c) => !enrolledClassIds.has(c.id));

  const changeEnrollment = async (enrollment, status, reason) => {
    try {
      await setEnrollment.mutateAsync({ classId: enrollment.classId, studentId: student.id, status, reason });
      toast.success(status === 'DROPPED' ? `Dropped from ${enrollment.subjectCode} · ${enrollment.section} (DRP).` : 'Reinstated in class.');
      setDropTarget(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const enroll = async () => {
    try {
      await enrollStudents.mutateAsync({ classId: enrollClassId, studentIds: [student.id] });
      toast.success(`Enrolled in ${formatClassLabel(activeClasses.find((c) => c.id === enrollClassId))}.`);
      setEnrollClassId('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleArchive = async () => {
    try {
      if (archived) await restoreStudent.mutateAsync(student.id);
      else await archiveStudent.mutateAsync(student.id);
      toast.success(archived ? 'Student restored.' : 'Student archived. All records are kept.');
      setConfirmArchive(false);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <Link to="/students" className="d-inline-flex align-items-center gap-1 small mb-3 text-decoration-none">
        <ArrowLeft size={14} aria-hidden="true" /> All students
      </Link>

      <section className="evsu-card p-4 mb-4" aria-labelledby="student-name">
        <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
          <div>
            <p className="text-muted-evsu small mb-1">{student.studentNumber}</p>
            <h2 id="student-name" className="h4 mb-2">{student.fullName}</h2>
            <div className="d-flex gap-2">
              {archived ? <StatusBadge status="ARCHIVED" /> : <StatusBadge status={student.enrollmentStatus} />}
            </div>
          </div>
          <div className="d-flex gap-2">
            {!archived && (
              <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden="true" /> Edit
              </button>
            )}
            <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setConfirmArchive(true)}>
              {archived ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
              {archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        </div>
        <dl className="evsu-details">
          <div><dt>Last name</dt><dd>{student.lastName}</dd></div>
          <div><dt>First name</dt><dd>{student.firstName}</dd></div>
          <div><dt>Middle name</dt><dd>{student.middleName ?? '—'}</dd></div>
          <div><dt>Email</dt><dd>{student.email ?? '—'}</dd></div>
          <div><dt>Course</dt><dd>{student.course}</dd></div>
          <div><dt>Year level</dt><dd>Year {student.yearLevel}</dd></div>
          <div><dt>Section</dt><dd>{student.section}</dd></div>
          <div><dt>Added</dt><dd>{formatDate(student.createdAt)}</dd></div>
          <div><dt>Last updated</dt><dd>{formatDate(student.updatedAt)}</dd></div>
        </dl>
      </section>

      <section className="evsu-card p-4" aria-labelledby="enrollments-heading">
        <div className="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
          <h3 id="enrollments-heading" className="h6 mb-0">Classes</h3>
          {!archived && enrollableClasses.length > 0 && (
            <div className="d-flex gap-2">
              <select className="form-select form-select-sm" aria-label="Class to enroll in" value={enrollClassId} onChange={(e) => setEnrollClassId(e.target.value)}>
                <option value="">Enroll in a class…</option>
                {enrollableClasses.map((c) => <option key={c.id} value={c.id}>{formatClassLabel(c)} ({c.schoolYear})</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={enroll} disabled={!enrollClassId || enrollStudents.isPending}>
                {enrollStudents.isPending ? <Spinner size="sm" label="" /> : <UserPlus size={14} aria-hidden="true" />} Enroll
              </button>
            </div>
          )}
        </div>

        {student.enrollments.length === 0 ? (
          <EmptyState title="Not enrolled in any class" description="Enroll this student in a class to record attendance and scores." />
        ) : (
          <ul className="list-unstyled mb-0">
            {student.enrollments.map((e) => (
              <li key={e.classId} className="d-flex flex-wrap align-items-center justify-content-between gap-2 py-3 border-top">
                <div>
                  <div className="fw-semibold">{e.subjectCode} · {e.section} <span className="fw-normal text-muted-evsu">— {e.subjectTitle}</span></div>
                  <div className="small text-muted-evsu">
                    {SEMESTER_LABELS[e.semester]}, SY {e.schoolYear} · enrolled {formatDate(e.enrolledAt)}
                    {e.status === 'DROPPED' && <> · dropped {formatDate(e.droppedAt)}{e.dropReason ? ` (${e.dropReason})` : ''}</>}
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <StatusBadge status={e.status === 'DROPPED' ? 'DRP' : 'ENROLLED'} />
                  {e.classStatus === 'ACTIVE' && !archived && (e.status === 'ENROLLED' ? (
                    <button type="button" className="btn btn-sm btn-light d-inline-flex align-items-center gap-1" onClick={() => setDropTarget(e)}>
                      <UserMinus size={14} aria-hidden="true" /> Drop
                    </button>
                  ) : (
                    <ActionButton className="btn btn-sm btn-light d-inline-flex align-items-center gap-1" onClick={() => changeEnrollment(e, 'ENROLLED')} disabled={setEnrollment.isPending} icon={UserPlus} iconSize={14}>
                      Reinstate
                    </ActionButton>
                  ))}
                  {e.classStatus === 'ARCHIVED' && <StatusBadge status="ARCHIVED" label="Class archived" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StudentGrades studentId={student.id} />
      <StudentAttendance studentId={student.id} enrollments={student.enrollments} />

      <StudentFormModal
        open={editing}
        student={student}
        onClose={() => setEditing(false)}
        onSubmit={async (values) => {
          await updateStudent.mutateAsync({ id: student.id, data: values });
          toast.success('Student updated.');
          setEditing(false);
        }}
      />
      <ConfirmDialog
        open={confirmArchive}
        title={archived ? 'Restore this student?' : 'Archive this student?'}
        message={archived
          ? <><strong>{student.fullName}</strong> will return to your active roster.</>
          : <><strong>{student.fullName}</strong> will be hidden from your active roster and new attendance sessions and score sheets. All attendance, scores, and grades are kept.</>}
        confirmLabel={archived ? 'Restore student' : 'Archive student'}
        tone="primary"
        busy={archiveStudent.isPending || restoreStudent.isPending}
        onConfirm={toggleArchive}
        onCancel={() => setConfirmArchive(false)}
      />
      <DropEnrollmentDialog
        open={Boolean(dropTarget)}
        studentName={student.fullName}
        classLabel={dropTarget ? `${dropTarget.subjectCode} · ${dropTarget.section}` : ''}
        busy={setEnrollment.isPending}
        onConfirm={(reason) => changeEnrollment(dropTarget, 'DROPPED', reason)}
        onCancel={() => setDropTarget(null)}
      />
    </>
  );
}
