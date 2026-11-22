import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, RotateCcw, Save } from 'lucide-react';
import { ASSESSMENT_TYPES } from '../../config/assessmentTypes';
import { useScoreSheet, useSaveScores, useUpdateAssessment } from '../../hooks/useAssessments';
import { useUnsavedChangesPrompt } from '../../hooks/useUnsavedChangesPrompt';
import { useToast } from '../../components/common/Toast';
import { periodLabel } from '../../components/common/GradingPeriodSelector';
import DataTable from '../../components/common/DataTable';
import SearchBar from '../../components/common/SearchBar';
import StatusBadge from '../../components/common/StatusBadge';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Spinner from '../../components/common/Spinner';
import { ErrorState, Skeleton } from '../../components/common/States';
import AssessmentStats from '../../components/assessments/AssessmentStats';
import AssessmentFormModal from '../../components/assessments/AssessmentFormModal';
import { formatDateOnly, formatPercent } from '../../utils/format';


const SCORE_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Parses a score cell: '' → null (no score), otherwise a number, or an error message. */
export function parseScoreInput(raw, maxScore) {
  const text = String(raw ?? '').trim();
  if (text === '') return { value: null };
  if (!SCORE_PATTERN.test(text)) return { error: 'Enter a number (up to 2 decimals), or leave blank for no score.' };
  const value = Number(text);
  if (value > maxScore) return { error: `Cannot exceed ${maxScore}.` };
  return { value };
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export default function AssessmentScoresPage({ typeKey }) {
  const type = ASSESSMENT_TYPES[typeKey];
  const { id } = useParams();
  const toast = useToast();
  const { data, isPending, error, refetch } = useScoreSheet(type, id);
  const saveScores = useSaveScores(type);
  const updateItem = useUpdateAssessment(type);

  const [draft, setDraft] = useState({}); // studentId → raw input text (only cells the user touched)
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [staleError, setStaleError] = useState(null);
  const [editing, setEditing] = useState(false);
  const inputs = useRef(new Map());

  const maxScore = data?.assessment.maxScore ?? 0;
  const savedById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.studentId, r.score])), [data]);

  // Changes = touched cells whose parsed value differs from what is saved.
  const { changes, invalid } = useMemo(() => {
    const result = { changes: [], invalid: new Map() };
    for (const [studentId, raw] of Object.entries(draft)) {
      const parsed = parseScoreInput(raw, maxScore);
      if (parsed.error) result.invalid.set(studentId, parsed.error);
      else if (parsed.value !== savedById.get(studentId)) result.changes.push({ studentId, score: parsed.value });
    }
    return result;
  }, [draft, maxScore, savedById]);

  const dirty = changes.length > 0 || invalid.size > 0;
  const leavePrompt = useUnsavedChangesPrompt(dirty);

  const visible = useMemo(() => {
    const term = fold(search.trim());
    return (data?.rows ?? []).filter((r) => {
      if (onlyMissing && r.score !== null) return false;
      return !term || fold(`${r.studentNumber} ${r.fullName}`).includes(term);
    });
  }, [data, search, onlyMissing]);

  if (isPending) {
    return (
      <div className="evsu-card p-4" aria-busy="true">
        <Skeleton width="40%" height="1.5rem" />
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mt-3" height="2rem" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="evsu-card">
        <ErrorState title={error.status === 404 ? `${type.Singular} not found` : `Could not load this ${type.singular}`} error={error} onRetry={error.status === 404 ? undefined : refetch} />
        <div className="text-center pb-4"><Link to={type.path}>Back to {type.title}</Link></div>
      </div>
    );
  }

  const { assessment, rows } = data;
  const cellValue = (row) => (row.studentId in draft ? draft[row.studentId] : row.score === null ? '' : String(row.score));

  const focusRow = (index) => {
    const target = visible[index];
    if (target) inputs.current.get(target.studentId)?.focus();
  };

  const save = async () => {
    setStaleError(null);
    try {
      const result = await saveScores.mutateAsync({ id, revision: assessment.revision, scores: changes });
      setDraft({});
      toast.success(`Scores saved (${result.changed} change${result.changed === 1 ? '' : 's'}).`);
    } catch (err) {
      if (err.code === 'STALE_REVISION') setStaleError(err.message);
      else if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) toast.error(err.details.map((d) => d.message).join(' '));
      else toast.error(err.message);
    }
  };

  const columns = [
    { key: 'studentNumber', header: 'Student No.', className: 'text-nowrap' },
    {
      key: 'fullName',
      header: 'Student Name',
      render: (r) => (
        <span className="d-inline-flex flex-wrap align-items-center gap-2">
          <span className="fw-semibold">{r.fullName}</span>
          {r.enrollmentStatus === 'DROPPED' && <StatusBadge status="DRP" />}
          {r.archived && <StatusBadge status="ARCHIVED" />}
          {(changes.some((c) => c.studentId === r.studentId) || invalid.has(r.studentId)) && <span className="evsu-unsaved-tag">Unsaved</span>}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      className: 'text-end',
      render: (r) => {
        const index = visible.indexOf(r);
        const problem = invalid.get(r.studentId);
        return (
          <div className="evsu-score-cell">
            <input
              ref={(el) => (el ? inputs.current.set(r.studentId, el) : inputs.current.delete(r.studentId))}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={`form-control form-control-sm text-end ${problem ? 'is-invalid' : ''}`}
              value={cellValue(r)}
              placeholder="No score"
              aria-label={`Score for ${r.fullName}`}
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? `err-${r.studentId}` : undefined}
              disabled={saveScores.isPending}
              onChange={(e) => setDraft((d) => ({ ...d, [r.studentId]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  focusRow(index + 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  focusRow(index - 1);
                }
              }}
            />
            {problem && <div id={`err-${r.studentId}`} className="invalid-feedback d-block text-start">{problem}</div>}
          </div>
        );
      },
    },
    { key: 'total', header: 'Total Possible', className: 'text-end', render: () => assessment.maxScore },
    {
      key: 'percent',
      header: 'Percentage',
      className: 'text-end',
      render: (r) => {
        const parsed = parseScoreInput(cellValue(r), assessment.maxScore);
        if (parsed.error) return '—';
        return parsed.value === null ? <span className="text-muted-evsu">No score</span> : formatPercent((parsed.value / assessment.maxScore) * 100);
      },
    },
  ];

  const requiredMissing = rows.filter((r) => r.required && r.score === null).length;

  return (
    <>
      {leavePrompt}
      <Link to={`${type.path}${assessment.period === 'FINALS' ? '?period=FINALS' : ''}`} className="d-inline-flex align-items-center gap-1 small mb-3 text-decoration-none">
        <ArrowLeft size={14} aria-hidden="true" /> All {type.title.toLowerCase()}
      </Link>

      <div className="evsu-page-header">
        <div>
          <h2 className="h4 mb-1">{assessment.title}</h2>
          <p className="mb-0 d-flex flex-wrap align-items-center gap-2 text-muted-evsu">
            <StatusBadge status={assessment.period} label={periodLabel(assessment.period)} tone="info" />
            {assessment.status === 'DRAFT' ? <StatusBadge status="DRAFT" label="Draft — not counted toward grades" tone="neutral" /> : <StatusBadge status="PUBLISHED" label="Published" tone="ok" />}
            <span>{formatDateOnly(assessment.date)}</span>
            <span>· Total possible <strong>{assessment.maxScore}</strong></span>
          </p>
        </div>
        <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setEditing(true)}>
          <Pencil size={16} aria-hidden="true" /> Edit details
        </button>
      </div>

      {(assessment.description || assessment.instructions) && (
        <div className="evsu-card p-3 mb-3 small">
          {assessment.description && <p className="mb-1">{assessment.description}</p>}
          {assessment.instructions && <p className="mb-0 text-muted-evsu"><strong>Instructions:</strong> {assessment.instructions}</p>}
        </div>
      )}

      <AssessmentStats stats={assessment.stats} maxScore={assessment.maxScore} />

      {staleError && (
        <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
          <span>{staleError}</span>
          <button type="button" className="btn btn-sm btn-warning" onClick={async () => { setDraft({}); setStaleError(null); await refetch(); }}>
            Reload latest (discard my changes)
          </button>
        </div>
      )}

      <div className="evsu-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Find a student" label="Find a student" />
        <div className="form-check form-switch">
          <input id="only-missing" type="checkbox" role="switch" className="form-check-input" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          <label htmlFor="only-missing" className="form-check-label small">Only students without a score ({requiredMissing})</label>
        </div>
      </div>
      <p className="small text-muted-evsu">
        Leave a cell blank for <strong>no score</strong> (shown as missing, and an INC once grades are computed). Type <strong>0</strong> only for an actual zero.
        Press Enter to move to the next student.
      </p>

      <DataTable
        caption={`Scores for ${assessment.title}`}
        columns={columns}
        rows={visible}
        rowKey={(r) => r.studentId}
        rowClassName={(r) => [invalid.has(r.studentId) || changes.some((c) => c.studentId === r.studentId) ? 'is-dirty' : '', r.required ? '' : 'text-muted-evsu'].join(' ')}
        empty={<p className="text-center text-muted-evsu py-4 mb-0">{rows.length ? 'No students match.' : 'No students are enrolled in this class.'}</p>}
      />

      <div className={`evsu-savebar ${dirty ? 'is-dirty' : ''}`} role="region" aria-label="Save scores">
        <span className="small" aria-live="polite">
          {invalid.size > 0 ? (
            <strong className="text-danger">{invalid.size} score{invalid.size === 1 ? '' : 's'} need fixing</strong>
          ) : changes.length ? (
            <strong>{changes.length} unsaved change{changes.length === 1 ? '' : 's'}</strong>
          ) : (
            <span className="text-muted-evsu">All changes saved</span>
          )}
        </span>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-light d-inline-flex align-items-center gap-1" onClick={() => setConfirmDiscard(true)} disabled={!dirty || saveScores.isPending}>
            <RotateCcw size={16} aria-hidden="true" /> Discard
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={save} disabled={!changes.length || invalid.size > 0 || saveScores.isPending}>
            {saveScores.isPending ? <Spinner size="sm" label="" /> : <Save size={16} aria-hidden="true" />} Save scores
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard unsaved changes?"
        message="Your unsaved score changes will be lost."
        confirmLabel="Discard changes"
        onConfirm={() => { setDraft({}); setConfirmDiscard(false); }}
        onCancel={() => setConfirmDiscard(false)}
      />
      <AssessmentFormModal
        open={editing}
        type={type}
        item={assessment}
        defaultPeriod={assessment.period}
        hasScores={assessment.stats.scoredCount > 0 || rows.some((r) => r.score !== null)}
        onClose={() => setEditing(false)}
        onSubmit={async (values) => {
          await updateItem.mutateAsync({ id, data: values });
          await refetch();
          toast.success(`${type.Singular} updated.`);
          setEditing(false);
        }}
      />
    </>
  );
}
