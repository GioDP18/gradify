import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Pencil, Trash2, School } from 'lucide-react';
import RefreshButton from '../../components/common/RefreshButton';
import useRefresh from '../../hooks/useRefresh';
import { useClassContext, formatClassLabel } from '../../context/ClassContext';
import { useAttendanceSessions, useAttendanceSummary, useCreateSession, useUpdateSession, useDeleteSession } from '../../hooks/useAttendance';
import { useToast } from '../../components/common/Toast';
import GradingPeriodSelector, { periodLabel } from '../../components/common/GradingPeriodSelector';
import DataTable from '../../components/common/DataTable';
import Pagination from '../../components/common/Pagination';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '../../components/common/States';
import SessionFormModal from '../../components/attendance/SessionFormModal';
import { formatDateOnly, formatPercent } from '../../utils/format';
import './attendance.css';
import Segmented from '../../components/common/Segmented';

const PAGE_SIZE = 25;

function StatTile({ label, value, tone }) {
  return (
    <div className="evsu-card p-3">
      <div className="small text-muted-evsu">{label}</div>
      <div className={`h4 mb-0 fw-semibold ${tone ? `text-${tone}` : ''}`}>{value}</div>
    </div>
  );
}

function SummaryTab({ classId, period, refreshing }) {
  const { data, isPending, error, refetch } = useAttendanceSummary({ classId, period }, { enabled: Boolean(classId) });
  if (error) return <div className="evsu-card"><ErrorState title="Could not load the summary" error={error} onRetry={refetch} /></div>;

  const totals = data?.periods.find((p) => p.period === period);
  const rows = (data?.students ?? []).filter((s) => s.period === period);
  const columns = [
    { key: 'studentNumber', header: 'Student No.', className: 'text-nowrap' },
    { key: 'fullName', header: 'Name', render: (s) => <Link to={`/students/${s.studentId}`} className="text-reset fw-semibold">{s.fullName}</Link> },
    { key: 'present', header: 'Present', className: 'text-end' },
    { key: 'absent', header: 'Absent', className: 'text-end', render: (s) => <span className={s.absent ? 'text-danger fw-semibold' : ''}>{s.absent}</span> },
    { key: 'excused', header: 'Excused', className: 'text-end' },
    { key: 'total', header: 'Sessions', className: 'text-end' },
    { key: 'attendanceRate', header: 'Attendance', className: 'text-end', render: (s) => formatPercent(s.attendanceRate) },
  ];

  return (
    <>
      <div className="evsu-stat-row mb-3">
        <StatTile label="Sessions" value={totals?.sessions ?? 0} />
        <StatTile label="Present" value={totals?.present ?? 0} tone="success" />
        <StatTile label="Absent" value={totals?.absent ?? 0} tone="danger" />
        <StatTile label="Excused" value={totals?.excused ?? 0} tone="warning" />
        <StatTile label="Attendance" value={formatPercent(totals?.attendanceRate)} />
      </div>
      <p className="small text-muted-evsu">Attendance = (Present + Excused) ÷ sessions, per the official grading criteria.</p>
      <DataTable
        caption={`${periodLabel(period)} attendance summary`}
        columns={columns}
        rows={rows}
        rowKey={(s) => s.studentId}
        loading={isPending || refreshing}
        empty={<EmptyState icon={CalendarCheck} title={`No ${periodLabel(period)} attendance yet`} description="Summaries appear after the first session is recorded." />}
      />
    </>
  );
}

export default function AttendancePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { activeClass, isLoading: classesLoading } = useClassContext();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') === 'FINALS' ? 'FINALS' : 'MIDTERM';
  const view = params.get('view') === 'summary' ? 'summary' : 'sessions';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const refresh = useRefresh([['attendance']]);
  const [formTarget, setFormTarget] = useState(null); // null | {} (new) | session (edit)
  const [deleteTarget, setDeleteTarget] = useState(null);

  const setParam = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const sessionsQuery = useAttendanceSessions(
    { classId: activeClass?.id, period, from, to, page, limit: PAGE_SIZE },
    { enabled: Boolean(activeClass) && view === 'sessions' },
  );
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();

  if (!classesLoading && !activeClass) {
    return (
      <div className="evsu-card">
        <EmptyState icon={School} title="Select a class first" description="Attendance is recorded per class. Create a class or pick one from the top bar."
          action={<Link to="/classes" className="btn btn-primary">Go to Classes</Link>} />
      </div>
    );
  }

  const handleSubmit = async (values) => {
    if (formTarget?.id) {
      await updateSession.mutateAsync({ id: formTarget.id, data: values });
      toast.success('Session updated.');
      setFormTarget(null);
    } else {
      const created = await createSession.mutateAsync({ ...values, classId: activeClass.id });
      toast.success(`Session created — ${created.counts.total} students marked present.`);
      setFormTarget(null);
      navigate(`/attendance/${created.id}`);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSession.mutateAsync(deleteTarget.id);
      toast.success('Attendance session deleted.');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    {
      key: 'sessionDate',
      header: 'Date',
      className: 'text-nowrap',
      render: (s) => <Link to={`/attendance/${s.id}`} className="fw-semibold text-reset">{formatDateOnly(s.sessionDate)}</Link>,
    },
    { key: 'description', header: 'Description', render: (s) => s.description ?? <span className="text-muted-evsu">—</span> },
    { key: 'present', header: 'Present', className: 'text-end', render: (s) => s.counts.present },
    { key: 'absent', header: 'Absent', className: 'text-end', render: (s) => <span className={s.counts.absent ? 'text-danger fw-semibold' : ''}>{s.counts.absent}</span> },
    { key: 'excused', header: 'Excused', className: 'text-end', render: (s) => s.counts.excused },
    { key: 'rate', header: 'Attendance', className: 'text-end', render: (s) => formatPercent(s.attendanceRate) },
    {
      key: 'actions',
      header: 'Actions',
      hideLabel: true,
      className: 'text-end text-nowrap',
      render: (s) => (
        <div className="d-inline-flex gap-1">
          <Link to={`/attendance/${s.id}`} className="btn btn-sm btn-outline-primary">Open</Link>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setFormTarget(s)} aria-label={`Edit session ${s.sessionDate}`} title="Edit">
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setDeleteTarget(s)} aria-label={`Delete session ${s.sessionDate}`} title="Delete">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  const data = sessionsQuery.data;

  return (
    <>
      <div className="evsu-page-header">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <GradingPeriodSelector value={period} onChange={(value) => setParam({ period: value === 'MIDTERM' ? '' : value })} />
          <Segmented label="View">
            <button type="button" aria-pressed={view === 'sessions'} onClick={() => setParam({ view: '' })}>Sessions</button>
            <button type="button" aria-pressed={view === 'summary'} onClick={() => setParam({ view: 'summary' })}>Student summary</button>
          </Segmented>
          <RefreshButton refresh={refresh} label="Refresh attendance" />
        </div>
        <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => setFormTarget({})} disabled={!activeClass}>
          <CalendarPlus size={18} aria-hidden="true" /> New session
        </button>
      </div>

      {view === 'summary' ? (
        <SummaryTab classId={activeClass?.id} period={period} refreshing={refresh.busy} />
      ) : (
        <>
          <div className="evsu-toolbar">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <label htmlFor="att-from" className="small text-muted-evsu">From</label>
              <input id="att-from" type="date" className="form-control form-control-sm w-auto" value={from} max={to || undefined} onChange={(e) => setParam({ from: e.target.value })} />
              <label htmlFor="att-to" className="small text-muted-evsu">To</label>
              <input id="att-to" type="date" className="form-control form-control-sm w-auto" value={to} min={from || undefined} onChange={(e) => setParam({ to: e.target.value })} />
              {(from || to) && <button type="button" className="btn btn-sm btn-link" onClick={() => setParam({ from: '', to: '' })}>Clear dates</button>}
            </div>
          </div>
          {sessionsQuery.error ? (
            <div className="evsu-card"><ErrorState title="Could not load attendance sessions" error={sessionsQuery.error} onRetry={sessionsQuery.refetch} /></div>
          ) : (
            <DataTable
              caption={`${periodLabel(period)} attendance sessions`}
              columns={columns}
              rows={data?.items ?? []}
              loading={sessionsQuery.isPending || sessionsQuery.isPlaceholderData || refresh.busy}
              empty={
                from || to ? (
                  <EmptyState title="No sessions in this date range" />
                ) : (
                  <EmptyState icon={CalendarCheck} title={`No ${periodLabel(period)} sessions yet`}
                    description={`Create a session to take attendance for ${formatClassLabel(activeClass)}. Everyone starts as present.`}
                    action={<button type="button" className="btn btn-primary" onClick={() => setFormTarget({})}>New session</button>} />
                )
              }
            />
          )}
          {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onPageChange={(p) => setParam({ page: String(p) })} />}
        </>
      )}

      <SessionFormModal
        open={formTarget !== null}
        session={formTarget?.id ? formTarget : null}
        defaultPeriod={period}
        classLabel={formatClassLabel(activeClass)}
        onClose={() => setFormTarget(null)}
        onSubmit={handleSubmit}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this attendance session?"
        message={deleteTarget && (
          <>
            The session on <strong>{formatDateOnly(deleteTarget.sessionDate)}</strong> ({periodLabel(deleteTarget.period)}) and its{' '}
            <strong>{deleteTarget.counts.total}</strong> attendance records will be deleted. This affects attendance grades for this period.
            A copy is kept in the audit log.
          </>
        )}
        confirmLabel="Delete session"
        busy={deleteSession.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
