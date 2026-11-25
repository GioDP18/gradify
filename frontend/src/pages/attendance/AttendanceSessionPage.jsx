import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCheck, RotateCcw, Save } from 'lucide-react';
import { useSessionRecords, useSaveSessionRecords } from '../../hooks/useAttendance';
import { useUnsavedChangesPrompt } from '../../hooks/useUnsavedChangesPrompt';
import { useToast } from '../../components/common/Toast';
import { periodLabel } from '../../components/common/GradingPeriodSelector';
import AttendanceStatusToggle, { ATTENDANCE_STATUSES } from '../../components/attendance/AttendanceStatusToggle';
import DataTable from '../../components/common/DataTable';
import SearchBar from '../../components/common/SearchBar';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Spinner from '../../components/common/Spinner';
import { ErrorState, Skeleton } from '../../components/common/States';
import { formatDateOnly, formatPercent } from '../../utils/format';
import './attendance.css';
import Segmented from '../../components/common/Segmented';

export default function AttendanceSessionPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data, isPending, error, refetch } = useSessionRecords(id);
  const saveRecords = useSaveSessionRecords();

  const [draft, setDraft] = useState({}); // studentId → status (only entries that differ from saved)
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [staleError, setStaleError] = useState(null);

  const savedById = useMemo(() => new Map((data?.records ?? []).map((r) => [r.studentId, r.status])), [data]);
  const dirtyCount = Object.keys(draft).length;
  const leavePrompt = useUnsavedChangesPrompt(dirtyCount > 0);

  const effective = (record) => draft[record.studentId] ?? record.status;

  const setStatus = (studentId, status) =>
    setDraft((current) => {
      const next = { ...current };
      if (savedById.get(studentId) === status) delete next[studentId];
      else next[studentId] = status;
      return next;
    });

  const setMany = (studentIds, status) => studentIds.forEach((sid) => setStatus(sid, status));

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, EXCUSED: 0 };
    (data?.records ?? []).forEach((r) => {
      c[draft[r.studentId] ?? r.status] += 1;
    });
    return c;
  }, [data, draft]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    return (data?.records ?? []).filter((r) => {
      if (statusFilter && (draft[r.studentId] ?? r.status) !== statusFilter) return false;
      if (!term) return true;
      return `${r.studentNumber} ${r.fullName}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(term);
    });
  }, [data, draft, search, statusFilter]);

  if (isPending) {
    return (
      <div className="evsu-card p-4" aria-busy="true">
        <Skeleton width="35%" height="1.5rem" />
        <Skeleton width="20%" className="mt-2" />
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mt-3" height="2rem" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="evsu-card">
        <ErrorState title={error.status === 404 ? 'Attendance session not found' : 'Could not load this session'} error={error} onRetry={error.status === 404 ? undefined : refetch} />
        <div className="text-center pb-4"><Link to="/attendance">Back to attendance</Link></div>
      </div>
    );
  }

  const { session, records } = data;

  const save = async () => {
    setStaleError(null);
    try {
      const result = await saveRecords.mutateAsync({
        id,
        revision: session.revision,
        records: Object.entries(draft).map(([studentId, status]) => ({ studentId, status })),
      });
      setDraft({});
      setSelected(new Set());
      toast.success(`Attendance saved (${result.changed} change${result.changed === 1 ? '' : 's'}).`);
    } catch (err) {
      if (err.code === 'STALE_REVISION') setStaleError(err.message);
      else toast.error(err.message);
    }
  };

  const reloadLatest = async () => {
    setDraft({});
    setStaleError(null);
    await refetch();
  };

  const columns = [
    { key: 'studentNumber', header: 'Student No.', className: 'text-nowrap' },
    {
      key: 'fullName',
      header: 'Name',
      render: (r) => (
        <span className="d-inline-flex flex-wrap align-items-center gap-2">
          <span className="fw-semibold">{r.fullName}</span>
          {r.enrollmentStatus === 'DROPPED' && <StatusBadge status="DRP" />}
          {r.archived && <StatusBadge status="ARCHIVED" />}
          {draft[r.studentId] && <span className="evsu-unsaved-tag">Unsaved</span>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'text-end',
      render: (r) => <AttendanceStatusToggle value={effective(r)} onChange={(s) => setStatus(r.studentId, s)} studentName={r.fullName} disabled={saveRecords.isPending} />,
    },
  ];

  return (
    <>
      {leavePrompt}
      <Link to={`/attendance${session.period === 'FINALS' ? '?period=FINALS' : ''}`} className="d-inline-flex align-items-center gap-1 small mb-3 text-decoration-none">
        <ArrowLeft size={14} aria-hidden="true" /> All sessions
      </Link>

      <div className="evsu-page-header">
        <div>
          <h2 className="h4 mb-1">{formatDateOnly(session.sessionDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
          <p className="text-muted-evsu mb-0">
            <StatusBadge status={session.period} label={periodLabel(session.period)} tone="info" />
            {session.description && <span className="ms-2">{session.description}</span>}
          </p>
        </div>
        <div className="evsu-att-counts" aria-live="polite">
          <span className="evsu-status evsu-status--ok">Present {counts.PRESENT}</span>
          <span className="evsu-status evsu-status--error">Absent {counts.ABSENT}</span>
          <span className="evsu-status evsu-status--warn">Excused {counts.EXCUSED}</span>
          <span className="small text-muted-evsu">Saved rate {formatPercent(session.attendanceRate)}</span>
        </div>
      </div>

      {staleError && (
        <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
          <span>{staleError}</span>
          <button type="button" className="btn btn-sm btn-warning" onClick={reloadLatest}>Reload latest (discard my changes)</button>
        </div>
      )}

      <div className="evsu-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Find a student" label="Find a student in this session" />
        <Segmented label="Show students by status">
          <button type="button" aria-pressed={statusFilter === ''} onClick={() => setStatusFilter('')}>All ({records.length})</button>
          {ATTENDANCE_STATUSES.map((s) => (
            <button key={s.value} type="button" aria-pressed={statusFilter === s.value} onClick={() => setStatusFilter(s.value)}>
              {s.label} ({counts[s.value]})
            </button>
          ))}
        </Segmented>
      </div>

      {selected.size > 0 && (
        <div className="evsu-bulkbar" role="region" aria-label="Bulk actions">
          <span>{selected.size} selected — mark as:</span>
          {ATTENDANCE_STATUSES.map((s) => (
            <button key={s.value} type="button" className="btn btn-sm btn-light" onClick={() => setMany([...selected], s.value)}>{s.label}</button>
          ))}
          <button type="button" className="btn btn-sm btn-link" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <DataTable
        caption="Attendance records"
        columns={columns}
        rows={visible}
        rowKey={(r) => r.studentId}
        rowLabel={(r) => r.fullName}
        selectedIds={selected}
        onSelectionChange={setSelected}
        rowClassName={(r) => (draft[r.studentId] ? 'is-dirty' : '')}
        empty={<p className="text-center text-muted-evsu py-4 mb-0">No students match.</p>}
      />

      <div className={`evsu-savebar ${dirtyCount ? 'is-dirty' : ''}`} role="region" aria-label="Save attendance">
        <span className="small" aria-live="polite">
          {dirtyCount ? <strong>{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}</strong> : <span className="text-muted-evsu">All changes saved</span>}
        </span>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-1" onClick={() => setMany(records.map((r) => r.studentId), 'PRESENT')} disabled={saveRecords.isPending}>
            <CheckCheck size={16} aria-hidden="true" /> Mark all present
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-1" onClick={() => setConfirmDiscard(true)} disabled={!dirtyCount || saveRecords.isPending}>
            <RotateCcw size={16} aria-hidden="true" /> Discard
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={save} disabled={!dirtyCount || saveRecords.isPending}>
            {saveRecords.isPending ? <Spinner size="sm" label="" /> : <Save size={16} aria-hidden="true" />} Save attendance
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard unsaved changes?"
        message={`Your ${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'} will be lost.`}
        confirmLabel="Discard changes"
        onConfirm={() => {
          setDraft({});
          setConfirmDiscard(false);
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
