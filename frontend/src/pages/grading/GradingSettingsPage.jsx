import { useEffect, useMemo, useState } from 'react';
import { History, Lock, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useGradingConfiguration, useGradingConfigurationVersions, useSaveConfiguration } from '../../hooks/useGrading';
import { useUnsavedChangesPrompt } from '../../hooks/useUnsavedChangesPrompt';
import { useToast } from '../../components/common/Toast';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Spinner from '../../components/common/Spinner';
import { ErrorState, Skeleton } from '../../components/common/States';
import { formatGrade } from '../../utils/format';

const PERIODS = [
  { key: 'MIDTERM', label: 'Midterm' },
  { key: 'FINALS', label: 'Finals' },
];
const WEIGHT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/** Sum of weight inputs, in hundredths, for the live "must total 100%" check (validation display only). */
const totalCents = (values) => values.reduce((sum, v) => sum + (WEIGHT_PATTERN.test(String(v).trim()) ? Math.round(Number(v) * 100) : NaN), 0);

function toForm(config) {
  return {
    periodWeights: Object.fromEntries(PERIODS.map((p) => [p.key, String(config.periodWeights[p.key])])),
    periods: Object.fromEntries(
      PERIODS.map((p) => [p.key, config.periods[p.key].components.map((c) => ({ key: c.key, source: c.source, label: c.label, weight: String(c.weight) }))]),
    ),
    notes: '',
  };
}

function conversionRows(table) {
  return [...table].sort((a, b) => b.minPercent - a.minPercent).map((b) => ({
    range: b.minPercent === b.maxPercent ? `${b.minPercent}%` : `${b.minPercent}–${b.maxPercent}%`,
    grade: formatGrade(b.grade),
  }));
}

export default function GradingSettingsPage() {
  const toast = useToast();
  const { user } = useAuth();
  // One shared set of criteria (D21): everyone reads it, only the administrator changes it.
  const canEdit = user?.role === 'ADMIN';
  const { data: config, isPending, error, refetch } = useGradingConfiguration();
  const versionsQuery = useGradingConfigurationVersions();
  const save = useSaveConfiguration();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);

  useEffect(() => {
    if (config && !editing) setForm(toForm(config));
  }, [config, editing]);

  const dirty = useMemo(() => editing && config && form && JSON.stringify({ ...form, notes: '' }) !== JSON.stringify(toForm(config)), [editing, config, form]);
  const leavePrompt = useUnsavedChangesPrompt(Boolean(dirty));

  if (isPending || !form) {
    if (error) return <div className="evsu-card"><ErrorState title="Could not load the grading criteria" error={error} onRetry={refetch} /></div>;
    return <div className="evsu-card p-4"><Skeleton width="40%" height="1.5rem" /><Skeleton className="mt-3" height="8rem" /></div>;
  }

  const periodTotal = totalCents(PERIODS.map((p) => form.periodWeights[p.key]));
  const componentTotals = Object.fromEntries(PERIODS.map((p) => [p.key, totalCents(form.periods[p.key].map((c) => c.weight))]));
  const labelProblems = PERIODS.some((p) => form.periods[p.key].some((c) => !c.label.trim() || c.label.length > 60));
  const valid = periodTotal === 10000 && PERIODS.every((p) => componentTotals[p.key] === 10000) && !labelProblems;

  const official = versionsQuery.data?.find((v) => v.version === 1);

  const setPeriodWeight = (key, value) => setForm((f) => ({ ...f, periodWeights: { ...f.periodWeights, [key]: value } }));
  const setComponent = (period, index, field, value) =>
    setForm((f) => ({ ...f, periods: { ...f.periods, [period]: f.periods[period].map((c, i) => (i === index ? { ...c, [field]: value } : c)) } }));

  const submit = async () => {
    setServerErrors([]);
    const changes = {
      periodWeights: Object.fromEntries(PERIODS.map((p) => [p.key, Number(form.periodWeights[p.key])])),
      periods: Object.fromEntries(
        PERIODS.map((p) => [p.key, { label: config.periods[p.key].label, components: form.periods[p.key].map((c) => ({ key: c.key, source: c.source, label: c.label.trim(), weight: Number(c.weight) })) }]),
      ),
      notes: form.notes.trim() || null,
    };
    try {
      const result = await save.mutateAsync(changes);
      toast.success(`Criteria version ${result.configuration.version} is now active for every class. Grades in ${result.classesToRecalculate} class${result.classesToRecalculate === 1 ? '' : 'es'} update automatically.`);
      setConfirmOpen(false);
      setEditing(false);
    } catch (err) {
      setConfirmOpen(false);
      setServerErrors(Array.isArray(err.details) ? err.details.map((d) => d.message) : [err.message]);
    }
  };

  const totalHint = (cents) => (
    <span className={cents === 10000 ? 'text-success' : 'text-danger'}>
      Total {Number.isNaN(cents) ? '—' : `${cents / 100}%`}{cents === 10000 ? '' : ' (must be 100%)'}
    </span>
  );

  return (
    <>
      {leavePrompt}
      <div className="evsu-page-header">
        <div>
          <h2 className="h5 mb-1">Criteria for grading — version {config.version}</h2>
          <p className="text-muted-evsu small mb-0">
            Active since {new Date(config.effectiveDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
            {config.notes ? ` · ${config.notes}` : ''}
          </p>
        </div>
        {!canEdit ? null : !editing ? (
          <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-2" onClick={() => { setForm(toForm(config)); setEditing(true); }}>
            <Pencil size={16} aria-hidden="true" /> Edit weights
          </button>
        ) : (
          <div className="d-flex flex-wrap gap-2">
            {official && (
              <button type="button" className="btn btn-light d-inline-flex align-items-center gap-2" onClick={() => setForm({ ...toForm(official), notes: 'Restored official EVSU criteria' })}>
                <RotateCcw size={16} aria-hidden="true" /> Use official criteria
              </button>
            )}
            <button type="button" className="btn btn-light" onClick={() => { setEditing(false); setServerErrors([]); }}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)} disabled={!valid || !dirty}>Save as new version</button>
          </div>
        )}
      </div>

      {canEdit ? (
        <div className="alert alert-info small d-flex gap-2" role="note">
          <ShieldCheck size={18} className="flex-shrink-0 mt-1" aria-hidden="true" />
          <span>
            Version 1 is the official EVSU <em>Criteria for Grading</em>. A change creates a new version (earlier versions are never altered)
            and applies to <strong>every instructor&apos;s classes</strong>. Their grades are recalculated with the new weights automatically.
          </span>
        </div>
      ) : (
        <div className="alert alert-info small d-flex gap-2" role="note">
          <Lock size={18} className="flex-shrink-0 mt-1" aria-hidden="true" />
          <span>
            These criteria are set by the administrator and apply to all classes. Version 1 is the official EVSU <em>Criteria for Grading</em>.
            When the administrator publishes a new version, your grades are recalculated with it automatically.
          </span>
        </div>
      )}

      {serverErrors.length > 0 && (
        <div className="alert alert-danger small" role="alert">
          <strong>The criteria were not saved:</strong>
          <ul className="mb-0">{serverErrors.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <section className="evsu-card p-3 p-md-4 mb-3" aria-labelledby="period-weights">
        <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
          <h3 id="period-weights" className="h6 mb-0">Period weights in the final grade</h3>
          {editing && <span className="small">{totalHint(periodTotal)}</span>}
        </div>
        <div className="row g-3">
          {PERIODS.map((p) => (
            <div key={p.key} className="col-sm-6 col-lg-3">
              <label htmlFor={`pw-${p.key}`} className="form-label small">{p.label} weight (%)</label>
              {editing ? (
                <input id={`pw-${p.key}`} className="form-control" inputMode="decimal" value={form.periodWeights[p.key]} onChange={(e) => setPeriodWeight(p.key, e.target.value)} />
              ) : (
                <p id={`pw-${p.key}`} className="h5 mb-0">{config.periodWeights[p.key]}%</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="row g-3 mb-3">
        {PERIODS.map((p) => (
          <div key={p.key} className="col-lg-6">
            <section className="evsu-card p-3 p-md-4 h-100" aria-labelledby={`components-${p.key}`}>
              <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                <h3 id={`components-${p.key}`} className="h6 mb-0">{config.periods[p.key].label}</h3>
                {editing && <span className="small">{totalHint(componentTotals[p.key])}</span>}
              </div>
              <table className="table evsu-table mb-0">
                <caption className="visually-hidden">{p.label} components</caption>
                <thead><tr><th scope="col">Component</th><th scope="col" className="text-end" style={{ width: '8rem' }}>Weight (%)</th></tr></thead>
                <tbody>
                  {form.periods[p.key].map((c, i) => (
                    <tr key={c.key}>
                      <td data-label="Component">
                        {editing ? (
                          <input className="form-control form-control-sm" aria-label={`${p.label} component ${i + 1} label`} value={c.label} maxLength={60}
                            onChange={(e) => setComponent(p.key, i, 'label', e.target.value)} />
                        ) : c.label}
                      </td>
                      <td data-label="Weight" className="text-end">
                        {editing ? (
                          <input className="form-control form-control-sm text-end" inputMode="decimal" aria-label={`${c.label} weight (${p.label})`} value={c.weight}
                            onChange={(e) => setComponent(p.key, i, 'weight', e.target.value)} />
                        ) : `${c.weight}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        ))}
      </div>

      {editing && (
        <div className="evsu-card p-3 p-md-4 mb-3">
          <label htmlFor="config-notes" className="form-label">Reason for this change</label>
          <input id="config-notes" className="form-control" maxLength={500} placeholder="e.g. Department memo no. 12, s. 2026" value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-lg-6">
          <section className="evsu-card p-3 p-md-4 h-100" aria-labelledby="conversion">
            <h3 id="conversion" className="h6">Grade conversion (Handbook §53.2)</h3>
            <p className="small text-muted-evsu">The computed percentage is rounded half-up to a whole number, then converted. Passing grade: {formatGrade(config.gradeConversion.passingGrade)}.</p>
            <details>
              <summary className="small">Show conversion table</summary>
              <div className="evsu-conversion-grid mt-2">
                {conversionRows(config.gradeConversion.table).map((r) => (
                  <div key={r.range} className="small"><span className="text-muted-evsu">{r.range}</span> → <strong>{r.grade}</strong></div>
                ))}
              </div>
            </details>
            <ul className="small mt-3 mb-0">
              {config.gradeConversion.remarks.map((r) => (
                <li key={r.label}>{formatGrade(r.minGrade)}{r.maxGrade !== r.minGrade ? `–${formatGrade(r.maxGrade)}` : ''}: {r.label}</li>
              ))}
            </ul>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="evsu-card p-3 p-md-4 h-100" aria-labelledby="inc-rule">
            <h3 id="inc-rule" className="h6">Special marks</h3>
            <ul className="small mb-0">
              <li><strong>INC</strong> — any required score is missing. Must be completed within {config.incompleteRule.complianceMonths} months after the term ends; otherwise it becomes {formatGrade(config.incompleteRule.lapseGrade)} (Handbook §55.1).</li>
              <li><strong>DRP</strong> — the student was dropped from the class.</li>
              <li>Missing scores are never counted as zero. A period with no items in a component is <em>not computable</em> (weights are never redistributed).</li>
              <li>Attendance = (Present + Excused) ÷ sessions.</li>
            </ul>
          </section>
        </div>
      </div>

      <section className="evsu-card p-3 p-md-4" aria-labelledby="versions">
        <h3 id="versions" className="h6 d-flex align-items-center gap-2"><History size={16} aria-hidden="true" /> Version history</h3>
        {versionsQuery.isPending && <Skeleton height="3rem" />}
        {versionsQuery.data && (
          <ul className="list-unstyled mb-0">
            {versionsQuery.data.map((v) => (
              <li key={v.id} className="py-2 border-top small d-flex flex-wrap gap-2 justify-content-between">
                <span>
                  <strong>Version {v.version}</strong>{v.isActive && <span className="evsu-status evsu-status--ok ms-2">Active</span>}
                  <span className="d-block text-muted-evsu">
                    Midterm {v.periodWeights.MIDTERM}% / Finals {v.periodWeights.FINALS}% · {v.periods.MIDTERM.components.map((c) => `${c.label} ${c.weight}%`).join(', ')}
                    {v.notes ? ` · ${v.notes}` : v.version === 1 ? ' · Official EVSU criteria' : ''}
                  </span>
                </span>
                <span className="text-muted-evsu">{new Date(v.createdAt).toLocaleString('en-PH')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="Activate new grading criteria?"
        message={<>This creates <strong>version {config.version + 1}</strong> for <strong>every instructor</strong>. All grades are recalculated with it. Version {config.version} remains in the history.</>}
        confirmLabel={save.isPending ? 'Saving…' : 'Save and recalculate'}
        tone="primary"
        busy={save.isPending}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
      {save.isPending && <span className="visually-hidden" role="status"><Spinner label="Recalculating grades" /></span>}
    </>
  );
}
