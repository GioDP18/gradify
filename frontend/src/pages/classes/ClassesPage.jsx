import { useState } from 'react';
import { Archive, ArchiveRestore, Check, Pencil, Plus, QrCode, School } from 'lucide-react';
import RefreshButton from '../../components/common/RefreshButton';
import useRefresh from '../../hooks/useRefresh';
import { useClassContext, formatTerm } from '../../context/ClassContext';
import { useArchiveClass, useCreateClass, useRestoreClass, useUpdateClass } from '../../hooks/useClasses';
import { useToast } from '../../components/common/Toast';
import ClassFormModal from '../../components/classes/ClassFormModal';
import QrEnrollmentDialog from '../../components/classes/QrEnrollmentDialog';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import ActionButton from '../../components/common/ActionButton';
import StatusBadge from '../../components/common/StatusBadge';
import { EmptyState, ErrorState, SkeletonCards } from '../../components/common/States';
import Segmented from '../../components/common/Segmented';

const FILTERS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const formatDate = (iso) => new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function ClassesPage() {
  const { classes, activeClass, selectClass, workingClass, isLoading, error } = useClassContext();
  const toast = useToast();
  const refresh = useRefresh([['classes']]);
  const [filter, setFilter] = useState('ACTIVE');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, class = edit
  const [qrFor, setQrFor] = useState(null); // class id whose QR enrollment dialog is open
  const [confirmArchive, setConfirmArchive] = useState(null);

  const createClass = useCreateClass();
  const updateClass = useUpdateClass();
  const archiveClass = useArchiveClass();
  const restoreClass = useRestoreClass();

  // Refreshing shows the skeleton too, so a slow reload is visible.
  const loading = isLoading || refresh.busy;
  const visible = classes.filter((cls) => cls.status === filter);

  const handleSubmit = async (values) => {
    if (editing?.id) {
      await updateClass.mutateAsync({ id: editing.id, data: values });
      toast.success('Class updated.');
    } else {
      const created = await createClass.mutateAsync(values);
      if (!activeClass) selectClass(created.id);
      toast.success(`${created.subjectCode} · ${created.section} created.`);
    }
    setEditing(null);
  };

  const handleArchive = async () => {
    try {
      await archiveClass.mutateAsync(confirmArchive.id);
      toast.success('Class archived. Its records are kept and it can be restored anytime.');
      setConfirmArchive(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRestore = async (cls) => {
    try {
      await restoreClass.mutateAsync(cls.id);
      toast.success('Class restored.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="evsu-page-header">
        <div>
          <p className="text-muted-evsu mb-0">Each class is one subject and section in a school term.</p>
        </div>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => setEditing({})}>
            <Plus size={18} aria-hidden="true" /> New class
          </button>
        </div>
      </div>

      <div className="evsu-toolbar">
        <Segmented label="Filter classes by status">
          {FILTERS.map((option) => (
            <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
              {option.label} ({classes.filter((c) => c.status === option.value).length})
            </button>
          ))}
        </Segmented>
        <RefreshButton refresh={refresh} label="Refresh classes" />
      </div>

      {loading && <SkeletonCards />}
      {error && <ErrorState title="Could not load classes" error={error} />}

      {!loading && !error && visible.length === 0 && (
        <div className="evsu-card">
          {filter === 'ACTIVE' ? (
            <EmptyState
              icon={School}
              title="No active classes yet"
              description="Create a class to start recording attendance, assessments, and grades."
              action={<button type="button" className="btn btn-primary" onClick={() => setEditing({})}>Create your first class</button>}
            />
          ) : (
            <EmptyState icon={Archive} title="No archived classes" description="Archived classes appear here with all their records intact." />
          )}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <ul className="evsu-grid list-unstyled mb-0">
          {visible.map((cls) => {
            // With Settings → working class off, each page picks its own class: no working class here.
            const isCurrent = workingClass && activeClass?.id === cls.id;
            return (
              <li key={cls.id} className={`evsu-card evsu-class-card p-4 d-flex flex-column ${isCurrent ? 'is-current' : ''}`}>
                <div className="d-flex align-items-start justify-content-between gap-2 mb-1">
                  <span className="evsu-class-card__code">{cls.subjectCode}</span>
                  {isCurrent ? <StatusBadge status="CURRENT" label="Working class" tone="info" /> : <StatusBadge status={cls.status} />}
                </div>
                <h2 className="h6 mb-1">{cls.subjectTitle}</h2>
                <p className="mb-3 small">
                  <span className="fw-semibold">{cls.section}</span>
                  <span className="text-muted-evsu d-block">{formatTerm(cls)}</span>
                </p>
                <p className="small text-muted-evsu mb-3">
                  Term ends {formatDate(cls.termEndDate)}
                  {cls.selfEnrollment?.open && cls.status === 'ACTIVE' && <span className="evsu-status evsu-status--ok ms-2">QR enrollment open</span>}
                </p>
                <div className="mt-auto d-flex flex-wrap gap-2">
                  {cls.status === 'ACTIVE' ? (
                    <>
                      {workingClass && !isCurrent && (
                        <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={() => selectClass(cls.id)}>
                          <Check size={14} aria-hidden="true" /> Work in this class
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-light d-inline-flex align-items-center gap-1" onClick={() => setEditing(cls)} aria-label={`Edit ${cls.subjectCode} ${cls.section}`}>
                        <Pencil size={14} aria-hidden="true" /> Edit
                      </button>
                      <button type="button" className="btn btn-sm btn-light d-inline-flex align-items-center gap-1" onClick={() => setConfirmArchive(cls)} aria-label={`Archive ${cls.subjectCode} ${cls.section}`}>
                        <Archive size={14} aria-hidden="true" /> Archive
                      </button>
                    </>
                  ) : (
                    <ActionButton
                      className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                      onClick={() => handleRestore(cls)}
                      disabled={restoreClass.isPending}
                      icon={ArchiveRestore}
                      iconSize={14}
                    >
                      Restore
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ClassFormModal
        open={editing !== null}
        initialClass={editing?.id ? editing : null}
        onClose={() => setEditing(null)}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(confirmArchive)}
        title="Archive this class?"
        message={
          confirmArchive && (
            <>
              <strong>{confirmArchive.subjectCode} · {confirmArchive.section}</strong> will be hidden from your active classes.
              No attendance, scores, or grades are deleted, and you can restore it at any time.
            </>
          )
        }
        confirmLabel="Archive class"
        tone="primary"
        busy={archiveClass.isPending}
        onConfirm={handleArchive}
        onCancel={() => setConfirmArchive(null)}
      />
      {qrFor && <QrEnrollmentDialog classId={qrFor} open onClose={() => setQrFor(null)} />}
    </>
  );
}
