import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Download, Pencil, Plus, QrCode, Upload, UserMinus, UserPlus, Users, Eye } from 'lucide-react';
import RefreshButton from '../../components/common/RefreshButton';
import useRefresh from '../../hooks/useRefresh';
import { useClassContext, formatClassLabel } from '../../context/ClassContext';
import {
  useStudentList, useStudentFacets, useCreateStudent, useUpdateStudent, useArchiveStudent, useRestoreStudent,
  useEnrollStudents, useSetEnrollmentStatus, useImportStudents,
} from '../../hooks/useStudents';
import { useDebounce } from '../../hooks/useDebounce';
import { exportStudents } from '../../services/studentsApi';
import { useToast } from '../../components/common/Toast';
import DataTable from '../../components/common/DataTable';
import Pagination from '../../components/common/Pagination';
import SearchBar from '../../components/common/SearchBar';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Spinner from '../../components/common/Spinner';
import { EmptyState, ErrorState } from '../../components/common/States';
import StudentFormModal, { STUDENT_STATUS_OPTIONS } from '../../components/students/StudentFormModal';
import ImportStudentsModal from '../../components/students/ImportStudentsModal';
import DropEnrollmentDialog from '../../components/students/DropEnrollmentDialog';
import QrEnrollmentDialog from '../../components/classes/QrEnrollmentDialog';
import Segmented from '../../components/common/Segmented';

const PAGE_SIZE = 20;

/** Reads list state from the URL so filters survive reloads and the back button. */
function useListState() {
  const [params, setParams] = useSearchParams();
  const state = {
    search: params.get('q') ?? '',
    course: params.get('course') ?? '',
    yearLevel: params.get('year') ?? '',
    section: params.get('section') ?? '',
    status: params.get('status') ?? '',
    scope: params.get('scope') === 'class' ? 'class' : 'all',
    enrollment: params.get('enrollment') ?? '',
    archived: params.get('archived') === 'true',
    sort: params.get('sort') ?? 'lastName',
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const KEYS = { search: 'q', yearLevel: 'year' };
  const update = (changes, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      const name = KEYS[key] ?? key;
      if (value === '' || value === false || value === null || value === undefined) next.delete(name);
      else next.set(name, String(value));
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  return [state, update];
}

export default function StudentsPage() {
  const toast = useToast();
  const { activeClass } = useClassContext();
  const [state, update] = useListState();
  const [searchText, setSearchText] = useState(state.search);
  const debouncedSearch = useDebounce(searchText);
  const [selected, setSelected] = useState(() => new Set());
  const [formTarget, setFormTarget] = useState(null); // null closed, {} new, student edit
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'archive'|'restore', student }
  const [dropTarget, setDropTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (debouncedSearch !== state.search) update({ search: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const inClassScope = state.scope === 'class' && Boolean(activeClass);
  const [qrOpen, setQrOpen] = useState(false);
  const query = useMemo(
    () => ({
      search: state.search,
      course: state.course,
      yearLevel: state.yearLevel,
      section: state.section,
      status: state.status,
      archived: state.archived,
      classId: inClassScope ? activeClass.id : undefined,
      enrollment: inClassScope ? state.enrollment : undefined,
      sort: state.sort,
      order: state.order,
      page: state.page,
      limit: PAGE_SIZE,
    }),
    [state.search, state.course, state.yearLevel, state.section, state.status, state.archived, state.enrollment, state.sort, state.order, state.page, inClassScope, activeClass?.id],
  );

  const { data, isPending, isFetching, error, refetch } = useStudentList(query);
  const refresh = useRefresh([['students'], ['classes']]);
  const facets = useStudentFacets().data;
  const rows = data?.items ?? [];

  // Selection only applies to what is visible.
  useEffect(() => setSelected(new Set()), [query]);

  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();
  const archiveStudent = useArchiveStudent();
  const restoreStudent = useRestoreStudent();
  const enrollStudents = useEnrollStudents();
  const setEnrollment = useSetEnrollmentStatus();
  const importStudents = useImportStudents();

  const handleSort = (field) => {
    const order = state.sort === field && state.order === 'asc' ? 'desc' : 'asc';
    update({ sort: field, order });
  };

  const handleSubmitStudent = async (values, { classId }) => {
    if (formTarget?.id) {
      await updateStudent.mutateAsync({ id: formTarget.id, data: values });
      toast.success('Student updated.');
    } else {
      const created = await createStudent.mutateAsync({ data: values, classId });
      toast.success(`${created.fullName} added${classId ? ` and enrolled in ${formatClassLabel(activeClass)}` : ''}.`);
    }
    setFormTarget(null);
  };

  const handleConfirm = async () => {
    const { type, student } = confirm;
    try {
      if (type === 'archive') {
        await archiveStudent.mutateAsync(student.id);
        toast.success(`${student.fullName} archived. All records are kept.`);
      } else {
        await restoreStudent.mutateAsync(student.id);
        toast.success(`${student.fullName} restored.`);
      }
      setConfirm(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleBulkEnroll = async () => {
    try {
      const result = await enrollStudents.mutateAsync({ classId: activeClass.id, studentIds: [...selected] });
      const parts = [`${result.enrolled} enrolled`];
      if (result.reinstated) parts.push(`${result.reinstated} reinstated`);
      if (result.alreadyEnrolled) parts.push(`${result.alreadyEnrolled} already enrolled`);
      toast.success(`${formatClassLabel(activeClass)}: ${parts.join(', ')}.`);
      setSelected(new Set());
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleEnrollmentChange = async (student, status, reason) => {
    try {
      await setEnrollment.mutateAsync({ classId: activeClass.id, studentId: student.id, status, reason });
      toast.success(status === 'DROPPED' ? `${student.fullName} dropped (DRP).` : `${student.fullName} reinstated.`);
      setDropTarget(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleImport = async (file, options, { final } = {}) => {
    const report = await importStudents.mutateAsync({ file, options });
    if (final) {
      const parts = [`${report.created} added`];
      if (report.enrolledExisting) parts.push(`${report.enrolledExisting} existing enrolled`);
      if (report.skipped) parts.push(`${report.skipped} skipped`);
      toast.success(`Import complete: ${parts.join(', ')}.`);
      setImportOpen(false);
    }
    return report;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { page, limit, ...filters } = query;
      await exportStudents(filters);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { key: 'studentNumber', header: 'Student No.', sortable: true, className: 'text-nowrap' },
    {
      key: 'lastName',
      header: 'Name',
      sortable: true,
      render: (s) => <Link to={`/students/${s.id}`} className="fw-semibold text-reset">{s.fullName}</Link>,
    },
    { key: 'course', header: 'Course', sortable: true },
    { key: 'yearLevel', header: 'Year', sortable: true },
    { key: 'section', header: 'Section', sortable: true },
    {
      key: 'enrollmentStatus',
      header: inClassScope ? 'Status / Class' : 'Status',
      sortable: !inClassScope,
      render: (s) => (
        <span className="d-inline-flex flex-wrap gap-1 justify-content-end">
          {s.archivedAt ? <StatusBadge status="ARCHIVED" /> : (!inClassScope || s.enrollmentStatus !== 'ENROLLED') && <StatusBadge status={s.enrollmentStatus} />}
          {inClassScope && s.enrollment && <StatusBadge status={s.enrollment.status === 'DROPPED' ? 'DRP' : 'ENROLLED'} label={s.enrollment.status === 'DROPPED' ? 'DRP' : 'In class'} />}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideLabel: true,
      className: 'text-end text-nowrap',
      render: (s) => (
        <div className="d-inline-flex gap-1">
          <Link to={`/students/${s.id}`} className="btn btn-sm btn-light" aria-label={`View ${s.fullName}`} title="View"><Eye size={15} aria-hidden="true" /></Link>
          {s.archivedAt ? (
            <button type="button" className="btn btn-sm btn-light" onClick={() => setConfirm({ type: 'restore', student: s })} aria-label={`Restore ${s.fullName}`} title="Restore">
              <ArchiveRestore size={15} aria-hidden="true" />
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setFormTarget(s)} aria-label={`Edit ${s.fullName}`} title="Edit">
                <Pencil size={15} aria-hidden="true" />
              </button>
              {inClassScope && s.enrollment?.status === 'ENROLLED' && (
                <button type="button" className="btn btn-sm btn-light" onClick={() => setDropTarget(s)} aria-label={`Drop ${s.fullName} from class`} title="Drop from class">
                  <UserMinus size={15} aria-hidden="true" />
                </button>
              )}
              {inClassScope && s.enrollment?.status === 'DROPPED' && (
                <button type="button" className="btn btn-sm btn-light" onClick={() => handleEnrollmentChange(s, 'ENROLLED')} aria-label={`Reinstate ${s.fullName} in class`} title="Reinstate in class">
                  <UserPlus size={15} aria-hidden="true" />
                </button>
              )}
              <button type="button" className="btn btn-sm btn-light" onClick={() => setConfirm({ type: 'archive', student: s })} aria-label={`Archive ${s.fullName}`} title="Archive">
                <Archive size={15} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const hasFilters = state.search || state.course || state.yearLevel || state.section || state.status || state.enrollment;
  const canBulkEnroll = !inClassScope && !state.archived && activeClass;

  return (
    <>
      <div className="evsu-page-header">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <Segmented label="Which students to show">
            <button type="button" aria-pressed={!inClassScope} onClick={() => update({ scope: '', enrollment: '' })}>All my students</button>
            <button type="button" aria-pressed={inClassScope} onClick={() => update({ scope: 'class', archived: false })} disabled={!activeClass}
              title={activeClass ? undefined : 'Create or select a class first'}>
              {activeClass ? `In ${formatClassLabel(activeClass)}` : 'In working class'}
            </button>
          </Segmented>
          <RefreshButton refresh={refresh} label="Refresh students" />
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={handleExport} disabled={exporting}>
            {exporting ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} Export CSV
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setImportOpen(true)}>
            <Upload size={16} aria-hidden="true" /> Import CSV
          </button>
          {inClassScope && (
            <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setQrOpen(true)}>
              <QrCode size={16} aria-hidden="true" /> QR code
              {activeClass.selfEnrollment?.open && <span className="evsu-status evsu-status--ok ms-1">Open</span>}
            </button>
          )}
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => setFormTarget({})}>
            <Plus size={16} aria-hidden="true" /> Add student
          </button>
        </div>
      </div>

      <div className="evsu-toolbar">
        <SearchBar value={searchText} onChange={setSearchText} placeholder="Search by student number or name" label="Search students" />
        <div className="evsu-filters">
          <select className="form-select" aria-label="Filter by course" value={state.course} onChange={(e) => update({ course: e.target.value })}>
            <option value="">All courses</option>
            {facets?.courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="form-select" aria-label="Filter by year level" value={state.yearLevel} onChange={(e) => update({ yearLevel: e.target.value })}>
            <option value="">All years</option>
            {facets?.yearLevels.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
          <select className="form-select" aria-label="Filter by section" value={state.section} onChange={(e) => update({ section: e.target.value })}>
            <option value="">All sections</option>
            {facets?.sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-select" aria-label="Filter by enrollment status" value={state.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Any status</option>
            {STUDENT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {inClassScope ? (
            <select className="form-select" aria-label="Filter by class enrollment" value={state.enrollment} onChange={(e) => update({ enrollment: e.target.value })}>
              <option value="">In class or dropped</option>
              <option value="ENROLLED">In class</option>
              <option value="DROPPED">Dropped (DRP)</option>
            </select>
          ) : (
            <div className="form-check form-switch align-self-center ms-1">
              <input id="show-archived" type="checkbox" role="switch" className="form-check-input" checked={state.archived} onChange={(e) => update({ archived: e.target.checked })} />
              <label htmlFor="show-archived" className="form-check-label small">Archived</label>
            </div>
          )}
        </div>
        {isFetching && !isPending && !refresh.busy && <Spinner size="sm" label="Updating results" className="text-muted-evsu" />}
      </div>

      {canBulkEnroll && selected.size > 0 && (
        <div className="evsu-bulkbar" role="region" aria-label="Bulk actions">
          <span>{selected.size} selected</span>
          <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={handleBulkEnroll} disabled={enrollStudents.isPending}>
            {enrollStudents.isPending ? <Spinner size="sm" label="" /> : <UserPlus size={14} aria-hidden="true" />}
            Enroll in {formatClassLabel(activeClass)}
          </button>
          <button type="button" className="btn btn-sm btn-link" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {error ? (
        <div className="evsu-card"><ErrorState title="Could not load students" error={error} onRetry={refetch} /></div>
      ) : (
        <DataTable
          caption="Students"
          columns={columns}
          rows={rows}
          loading={isPending || refresh.busy}
          sort={{ field: state.sort, order: state.order }}
          onSortChange={handleSort}
          selectedIds={selected}
          onSelectionChange={canBulkEnroll ? setSelected : undefined}
          rowLabel={(s) => s.fullName}
          rowClassName={(s) => (s.enrollment?.status === 'DROPPED' || s.archivedAt ? 'text-muted-evsu' : '')}
          empty={
            hasFilters ? (
              <EmptyState title="No students match your filters" description="Try a different search or clear the filters." />
            ) : state.archived ? (
              <EmptyState icon={Archive} title="No archived students" />
            ) : inClassScope ? (
              <EmptyState icon={Users} title={`No students in ${formatClassLabel(activeClass)} yet`}
                description="Switch to “All my students” to select and enroll students, or import a class list."
                action={<button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>Import class list</button>} />
            ) : (
              <EmptyState icon={Users} title="No students yet" description="Add students one at a time or import a CSV class list."
                action={<button type="button" className="btn btn-primary" onClick={() => setFormTarget({})}>Add student</button>} />
            )
          }
        />
      )}

      {data && (
        <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit}
          onPageChange={(page) => update({ page }, { resetPage: false })} />
      )}

      <StudentFormModal
        open={formTarget !== null}
        student={formTarget?.id ? formTarget : null}
        activeClass={activeClass}
        onClose={() => setFormTarget(null)}
        onSubmit={handleSubmitStudent}
      />
      <ImportStudentsModal open={importOpen} activeClass={activeClass} onClose={() => setImportOpen(false)} onImport={handleImport} />
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.type === 'archive' ? 'Archive this student?' : 'Restore this student?'}
        message={
          confirm?.type === 'archive' ? (
            <><strong>{confirm.student.fullName}</strong> will be hidden from your active roster and from new attendance sessions and score sheets. Their attendance, scores, and grades are kept, and you can restore them anytime.</>
          ) : (
            confirm && <><strong>{confirm.student.fullName}</strong> will return to your active roster.</>
          )
        }
        confirmLabel={confirm?.type === 'archive' ? 'Archive student' : 'Restore student'}
        tone="primary"
        busy={archiveStudent.isPending || restoreStudent.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
      <DropEnrollmentDialog
        open={Boolean(dropTarget)}
        studentName={dropTarget?.fullName}
        classLabel={formatClassLabel(activeClass)}
        busy={setEnrollment.isPending}
        onConfirm={(reason) => handleEnrollmentChange(dropTarget, 'DROPPED', reason)}
        onCancel={() => setDropTarget(null)}
      />
      {inClassScope && <QrEnrollmentDialog classId={activeClass.id} open={qrOpen} onClose={() => setQrOpen(false)} />}
    </>
  );
}
