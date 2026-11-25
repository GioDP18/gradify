import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2, School } from 'lucide-react';
import RefreshButton from '../../components/common/RefreshButton';
import useRefresh from '../../hooks/useRefresh';
import { ASSESSMENT_TYPES } from '../../config/assessmentTypes';
import { useClassContext, formatClassLabel } from '../../context/ClassContext';
import { useAssessmentList, useCreateAssessment, useUpdateAssessment, useDeleteAssessment } from '../../hooks/useAssessments';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../components/common/Toast';
import GradingPeriodSelector, { periodLabel } from '../../components/common/GradingPeriodSelector';
import DataTable from '../../components/common/DataTable';
import SearchBar from '../../components/common/SearchBar';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '../../components/common/States';
import AssessmentFormModal from '../../components/assessments/AssessmentFormModal';
import { formatDateOnly, formatPercent } from '../../utils/format';

/** Quizzes / activities / examinations list for the working class, per grading period. */
export default function AssessmentListPage({ typeKey }) {
  const type = ASSESSMENT_TYPES[typeKey];
  const toast = useToast();
  const navigate = useNavigate();
  const { activeClass, isLoading: classesLoading } = useClassContext();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') === 'FINALS' ? 'FINALS' : 'MIDTERM';
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [formTarget, setFormTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const query = useAssessmentList(type, { classId: activeClass?.id, period, status, search: debouncedSearch }, { enabled: Boolean(activeClass) });
  const refresh = useRefresh([['assessments', type.key]]);
  const createItem = useCreateAssessment(type);
  const updateItem = useUpdateAssessment(type);
  const deleteItem = useDeleteAssessment(type);

  const setParam = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  if (!classesLoading && !activeClass) {
    return (
      <div className="evsu-card">
        <EmptyState icon={School} title="Select a class first" description={`${type.title} belong to a class. Create a class or pick one from the top bar.`}
          action={<Link to="/classes" className="btn btn-primary">Go to Classes</Link>} />
      </div>
    );
  }

  const handleSubmit = async (values) => {
    if (formTarget?.id) {
      await updateItem.mutateAsync({ id: formTarget.id, data: values });
      toast.success(`${type.Singular} updated.`);
      setFormTarget(null);
    } else {
      const created = await createItem.mutateAsync({ ...values, classId: activeClass.id });
      toast.success(`${type.Singular} created. Enter the scores below.`);
      setFormTarget(null);
      navigate(`${type.path}/${created.id}`);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteItem.mutateAsync(deleteTarget.id);
      toast.success(`${type.Singular} deleted. Its scores are kept in the records.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'title', header: 'Title', render: (i) => <Link to={`${type.path}/${i.id}`} className="fw-semibold text-reset">{i.title}</Link> },
    { key: 'date', header: 'Date', className: 'text-nowrap', render: (i) => formatDateOnly(i.date, { month: 'short', day: 'numeric', year: 'numeric' }) },
    { key: 'maxScore', header: 'Total', className: 'text-end' },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} label={i.status === 'DRAFT' ? 'Draft' : 'Published'} tone={i.status === 'DRAFT' ? 'neutral' : 'ok'} /> },
    {
      key: 'scored',
      header: 'Scored',
      className: 'text-end text-nowrap',
      render: (i) => (
        <span className={i.stats.missingCount > 0 && i.status === 'PUBLISHED' ? 'text-warning-emphasis fw-semibold' : ''}>
          {i.stats.scoredCount} / {i.stats.totalStudents}
        </span>
      ),
    },
    { key: 'average', header: 'Average', className: 'text-end', render: (i) => formatPercent(i.stats.averagePercent) },
    {
      key: 'actions',
      header: 'Actions',
      hideLabel: true,
      className: 'text-end text-nowrap',
      render: (i) => (
        <div className="d-inline-flex gap-1">
          <Link to={`${type.path}/${i.id}`} className="btn btn-sm btn-outline-primary">Scores</Link>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setFormTarget(i)} aria-label={`Edit ${i.title}`} title="Edit"><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setDeleteTarget(i)} aria-label={`Delete ${i.title}`} title="Delete"><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="evsu-page-header">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <GradingPeriodSelector value={period} onChange={(v) => setParam({ period: v === 'MIDTERM' ? '' : v })} />
          <RefreshButton refresh={refresh} label={`Refresh ${type.title.toLowerCase()}`} />
          <span className="small text-muted-evsu">Counts toward <strong>{type.component}</strong></span>
        </div>
        <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => setFormTarget({})}>
          <Plus size={18} aria-hidden="true" /> New {type.singular}
        </button>
      </div>

      <div className="evsu-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder={`Search ${type.title.toLowerCase()}`} label={`Search ${type.title.toLowerCase()}`} />
        <select className="form-select w-auto" aria-label="Filter by status" value={status} onChange={(e) => setParam({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
        </select>
      </div>

      {query.error ? (
        <div className="evsu-card"><ErrorState title={`Could not load ${type.title.toLowerCase()}`} error={query.error} onRetry={query.refetch} /></div>
      ) : (
        <DataTable
          caption={`${periodLabel(period)} ${type.title}`}
          columns={columns}
          rows={query.data ?? []}
          loading={query.isPending || query.isPlaceholderData || refresh.busy}
          empty={
            search || status ? (
              <EmptyState title="Nothing matches your filters" />
            ) : (
              <EmptyState icon={type.icon} title={`No ${periodLabel(period)} ${type.title.toLowerCase()} yet`}
                description={`Create a ${type.singular} for ${formatClassLabel(activeClass)} to start recording scores.`}
                action={<button type="button" className="btn btn-primary" onClick={() => setFormTarget({})}>New {type.singular}</button>} />
            )
          }
        />
      )}

      <AssessmentFormModal
        open={formTarget !== null}
        type={type}
        item={formTarget?.id ? formTarget : null}
        defaultPeriod={period}
        hasScores={Boolean(formTarget?.stats?.scoredCount)}
        onClose={() => setFormTarget(null)}
        onSubmit={handleSubmit}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete this ${type.singular}?`}
        message={deleteTarget && (
          <>
            <strong>{deleteTarget.title}</strong> will no longer count toward grades and will be removed from this list.
            Its {deleteTarget.stats.scoredCount} recorded score{deleteTarget.stats.scoredCount === 1 ? '' : 's'} are kept in the records, and affected grades are recalculated.
          </>
        )}
        confirmLabel={`Delete ${type.singular}`}
        busy={deleteItem.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
