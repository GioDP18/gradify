import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calculator, Download, Printer, RefreshCw, School, Settings2, TriangleAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useClassContext, formatClassLabel, formatTerm } from '../../context/ClassContext';
import { useClassGrades, useRecalculateClass } from '../../hooks/useGrading';
import { exportClassGrades } from '../../services/gradingApi';
import { useToast } from '../../components/common/Toast';
import { useCategoryAxisProps } from '../../hooks/useMediaQuery';
import DataTable from '../../components/common/DataTable';
import SearchBar from '../../components/common/SearchBar';
import Spinner from '../../components/common/Spinner';
import ActionButton from '../../components/common/ActionButton';
import { EmptyState, ErrorState, Skeleton } from '../../components/common/States';
import GradeStatusBadge from '../../components/grading/GradeStatusBadge';
import GradeChip from '../../components/grading/GradeChip';
import { CHART, bucketFill } from '../../config/chartTheme';
import PrintHeader from '../../components/grading/PrintHeader';
import { formatPercentFixed } from '../../utils/format';
import Segmented from '../../components/common/Segmented';

export const GRADING_TABS = [
  { value: 'midterm', label: 'Midterm' },
  { value: 'finals', label: 'Finals' },
  { value: 'overall', label: 'Final Grade' },
];

const STATUS_FILTERS = [
  { value: '', label: 'All students' },
  { value: 'COMPLETE', label: 'With grade' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'INCOMPLETE', label: 'INC' },
  { value: 'DROPPED', label: 'DRP' },
  { value: 'NOT_COMPUTABLE', label: 'Not computable' },
  { value: 'INC_LAPSED', label: 'INC lapsed' },
  { value: 'PENDING', label: 'Pending' },
];

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

function Tile({ label, value, hint }) {
  return (
    <div className="evsu-card p-3">
      <div className="small text-muted-evsu">{label}</div>
      <div className="h5 mb-0 fw-semibold">{value}</div>
      {hint && <div className="small text-muted-evsu">{hint}</div>}
    </div>
  );
}

/** Stands in for the grade distribution chart while a sheet loads: a card of rising and falling bars. */
function ChartSkeleton() {
  const heights = [28, 46, 70, 92, 78, 58, 40, 24, 34];
  return (
    <div className="evsu-card p-3 mb-3 no-print" aria-hidden="true">
      <h2 className="h6 mb-3">Grade distribution</h2>
      <div className="evsu-chart-skeleton">
        {heights.map((h, i) => <Skeleton key={i} width="100%" height={`${h}%`} />)}
      </div>
    </div>
  );
}

/** Class grading sheet. Every number shown comes from the grading engine. */
export default function GradingPage() {
  const toast = useToast();
  const { activeClass, isLoading: classesLoading } = useClassContext();
  const [params, setParams] = useSearchParams();
  const period = GRADING_TABS.some((t) => t.value === params.get('period')) ? params.get('period') : 'midterm';
  const [search, setSearch] = useState('');
  // Dashboard cards link here with ?status=… to pre-filter the sheet.
  const [statusFilter, setStatusFilter] = useState(() => (STATUS_FILTERS.some((f) => f.value === params.get('status')) ? params.get('status') : ''));
  const [sort, setSort] = useState({ field: 'fullName', order: 'asc' });
  const [exporting, setExporting] = useState(null);

  const { data, isPending, isFetching, isPlaceholderData, error, refetch } = useClassGrades(period, activeClass?.id);
  // Switching to a period (or class) that is not loaded yet: show the skeleton, not the previous sheet.
  const switching = isPlaceholderData;
  // While loading, the sheet keeps its own layout (tiles, chart, table) with placeholders in it.
  const loading = (isPending || switching) && !error;
  const figure = (render) => (loading ? <Skeleton width="3.25rem" height="2.05rem" /> : render());
  const recalc = useRecalculateClass();
  const axisProps = useCategoryAxisProps();

  const rows = useMemo(() => {
    const term = fold(search.trim());
    const filtered = (data?.rows ?? []).filter((r) => {
      if (statusFilter === 'PENDING' && r.current) return false;
      // Failed = a complete grade worse than 3.0 (the same rule the dashboard counts by).
      if (statusFilter === 'FAILED') {
        if (!r.current || r.completionStatus !== 'COMPLETE' || !(r.grade > 3.0)) return false;
      } else if (statusFilter && statusFilter !== 'PENDING' && (!r.current || r.completionStatus !== statusFilter)) return false;
      return !term || fold(`${r.studentNumber} ${r.fullName}`).includes(term);
    });
    const dir = sort.order === 'desc' ? -1 : 1;
    const value = (r) => {
      if (sort.field === 'grade') return r.current && r.grade !== null ? r.grade : Infinity;
      if (sort.field === 'percentage') return r.current && r.percentage !== null ? r.percentage : -Infinity;
      return String(r[sort.field] ?? '');
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return cmp * dir || a.fullName.localeCompare(b.fullName);
    });
  }, [data, search, statusFilter, sort]);

  if (!classesLoading && !activeClass) {
    return (
      <div className="evsu-card">
        <EmptyState icon={School} title="Select a class first" description="Grades are computed per class. Create a class or pick one from the top bar."
          action={<Link to="/classes" className="btn btn-primary">Go to Classes</Link>} />
      </div>
    );
  }

  const config = data?.configuration;
  const summary = data?.summary;
  const isOverall = period === 'overall';
  const reportLink = (studentId) => `/grading/${period}/student/${studentId}?classId=${activeClass?.id}`;

  const handleExport = async (format) => {
    setExporting(format);
    try {
      await exportClassGrades(period, activeClass.id, format);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(null);
    }
  };

  const handleRecalculate = async () => {
    try {
      const result = await recalc.mutateAsync(activeClass.id);
      toast.success(`Recalculated ${result.recalculated} student${result.recalculated === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const pct = (r, value) => (r.current ? formatPercentFixed(value) : '—');

  const componentColumns = !config
    ? []
    : isOverall
      ? ['MIDTERM', 'FINALS'].map((p) => ({
          key: p,
          header: <>{p === 'MIDTERM' ? 'Midterm' : 'Finals'}<span className="evsu-th-sub">{config.periodWeights[p]}%</span></>,
          label: `${p === 'MIDTERM' ? 'Midterm' : 'Finals'} (${config.periodWeights[p]}%)`,
          className: 'text-end text-nowrap',
          render: (r) =>
            r.current && r.periodResults?.[p] ? (
              <span>
                {formatPercentFixed(r.periodResults[p].percentage)}
                <span className="d-block mt-1"><GradeChip size="sm" grade={r.periodResults[p].grade} text={r.periodResults[p].grade !== null ? undefined : r.periodResults[p].status === 'INCOMPLETE' ? 'INC' : r.periodResults[p].status === 'DROPPED' ? 'DRP' : '—'} /></span>
              </span>
            ) : '—',
        }))
      : config.periods[period.toUpperCase()].components.map((c) => ({
          key: c.key,
          header: <>{c.label}<span className="evsu-th-sub">{c.weight}%</span></>,
          label: `${c.label} (${c.weight}%)`,
          className: 'text-end',
          render: (r) => {
            const comp = r.components.find((x) => x.key === c.key);
            return r.current && comp ? (
              <span>
                {formatPercentFixed(comp.percentage)}
                {comp.weightedContribution !== null && <span className="d-block small text-muted-evsu">{Number(comp.weightedContribution.toFixed(2))} pts</span>}
              </span>
            ) : '—';
          },
        }));

  const columns = [
    { key: 'studentNumber', header: 'Student No.', sortable: true, className: 'text-nowrap' },
    {
      key: 'fullName',
      header: 'Student Name',
      sortable: true,
      className: 'evsu-col-name',
      render: (r) => (
        <span>
          <Link to={reportLink(r.studentId)} className="fw-semibold text-reset">{r.fullName}</Link>
          {r.current && r.missingItems?.length > 0 && r.completionStatus !== 'DROPPED' && (
            <span className="d-block small text-danger">Missing: {r.missingItems.map((m) => m.title).join(', ')}</span>
          )}
        </span>
      ),
    },
    ...componentColumns,
    { key: 'percentage', header: isOverall ? 'Final %' : 'Computed %', sortable: true, className: 'text-end', render: (r) => pct(r, r.percentage) },
    { key: 'grade', header: 'Grade', sortable: true, className: 'text-end', render: (r) => (r.current ? <GradeChip grade={r.grade} /> : <GradeChip text="—" />) },
    { key: 'remarks', header: 'Remarks', className: 'text-nowrap', render: (r) => <GradeStatusBadge result={r} passingGrade={config?.passingGrade} /> },
    {
      key: 'actions',
      header: 'Actions',
      hideLabel: true,
      className: 'text-end text-nowrap no-print',
      render: (r) => (
        <Link to={reportLink(r.studentId)} className="btn btn-sm btn-light" aria-label={`View calculation for ${r.fullName}`} title="View calculation">
          <Calculator size={15} aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <>
      <PrintHeader
        title={`Class Grading Sheet — ${GRADING_TABS.find((t) => t.value === period).label}`}
        lines={activeClass ? [`${activeClass.subjectCode} · ${activeClass.subjectTitle} · ${activeClass.section}`, formatTerm(activeClass)] : []}
      />

      <div className="evsu-page-header no-print">
        <Segmented label="Grading period">
          {GRADING_TABS.map((tab) => (
            <button key={tab.value} type="button" aria-pressed={period === tab.value} onClick={() => setParams(tab.value === 'midterm' ? {} : { period: tab.value }, { replace: true })}>
              {tab.label}
            </button>
          ))}
        </Segmented>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={handleRecalculate} disabled={recalc.isPending || !activeClass}>
            {recalc.isPending ? <Spinner size="sm" label="" /> : <RefreshCw size={16} aria-hidden="true" />} Recalculate
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => handleExport('csv')} disabled={Boolean(exporting) || !data}>
            {exporting === 'csv' ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} CSV
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => handleExport('xlsx')} disabled={Boolean(exporting) || !data}>
            {exporting === 'xlsx' ? <Spinner size="sm" label="" /> : <Download size={16} aria-hidden="true" />} Excel
          </button>
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => window.print()} disabled={!data}>
            <Printer size={16} aria-hidden="true" /> Print
          </button>
          <Link to="/settings/grading" className="btn btn-outline-primary d-inline-flex align-items-center gap-2">
            <Settings2 size={16} aria-hidden="true" /> Grading criteria
          </Link>
        </div>
      </div>

      {config && (
        <p className="small text-muted-evsu">
          {isOverall
            ? <>Final grade = Midterm × {config.periodWeights.MIDTERM}% + Finals × {config.periodWeights.FINALS}%, converted to the 1.0–5.0 scale.</>
            : <>Each column shows its official weight; the grade is their weighted sum, converted to the 1.0–5.0 scale.</>}{' '}
          Criteria version {config.version}. {activeClass && <span className="no-print">Class {formatClassLabel(activeClass)}.</span>}
        </p>
      )}

      {error && <div className="evsu-card"><ErrorState title="Could not load grades" error={error} onRetry={refetch} /></div>}
      {(loading || summary) && (
        <>
          {!loading && summary.pending > 0 && (
            <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2 no-print" role="status">
              <span className="d-inline-flex align-items-center gap-2">
                <TriangleAlert size={16} aria-hidden="true" />
                {summary.pending} grade{summary.pending === 1 ? ' is' : 's are'} pending recalculation and {summary.pending === 1 ? 'is' : 'are'} not shown as final.
              </span>
              <ActionButton className="btn btn-sm btn-warning" onClick={handleRecalculate} busy={recalc.isPending}>Recalculate now</ActionButton>
            </div>
          )}

          <div className="evsu-stat-row mb-3" aria-busy={loading || undefined}>
            <Tile label="Students" value={figure(() => summary.totalStudents)} />
            <Tile label="With grade" value={figure(() => summary.complete)} hint={loading ? <Skeleton width="4.5rem" height="0.85rem" className="mt-1" /> : `${summary.passed} passed`} />
            <Tile label="INC" value={figure(() => summary.incomplete + summary.lapsed)} hint={!loading && summary.lapsed ? `${summary.lapsed} lapsed` : undefined} />
            <Tile label="DRP" value={figure(() => summary.dropped)} />
            <Tile label="Class average" value={figure(() => formatPercentFixed(summary.averagePercentage))} hint="of computed %" />
            <Tile label="Highest grade" value={figure(() => (summary.highestGrade === null || summary.highestGrade === undefined ? '—' : <GradeChip grade={summary.highestGrade} />))} />
            <Tile label="Lowest grade" value={figure(() => (summary.lowestGrade === null || summary.lowestGrade === undefined ? '—' : <GradeChip grade={summary.lowestGrade} />))} />
          </div>

          {loading && <ChartSkeleton />}
          {!loading && summary.distribution.some((d) => d.count > 0) && (
            <div className="evsu-card p-3 mb-3 no-print">
              <h2 className="h6 mb-3">Grade distribution</h2>
              <div style={{ width: '100%', height: 200 }} role="img" aria-label={`Grade distribution: ${summary.distribution.map((d) => `${d.label}: ${d.count}`).join(', ')}`}>
                <ResponsiveContainer>
                  <BarChart data={summary.distribution} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => [v, 'Students']} />
                    <Bar isAnimationActive={false} dataKey="count" radius={[4, 4, 0, 0]}>
                      {summary.distribution.map((d) => <Cell key={d.label} fill={bucketFill(d.label)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="evsu-toolbar no-print">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by student number or name" label="Search students" />
            <select className="form-select w-auto" aria-label="Filter by result" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            {isFetching && !loading && <Spinner size="sm" label="Refreshing grades" className="text-muted-evsu" />}
          </div>

          <DataTable
            caption={`${GRADING_TABS.find((t) => t.value === period).label} grades`}
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(r) => r.studentId}
            sort={sort}
            onSortChange={(field) => setSort((s) => ({ field, order: s.field === field && s.order === 'asc' ? 'desc' : 'asc' }))}
            rowClassName={(r) => (r.completionStatus === 'DROPPED' ? 'text-muted-evsu' : '')}
            empty={
              !data || data.rows.length === 0
                ? <EmptyState title="No students enrolled" description="Enroll students in this class to see their grades." action={<Link to="/students" className="btn btn-primary">Go to Students</Link>} />
                : <EmptyState title="No students match your filters" />
            }
          />
        </>
      )}
    </>
  );
}
