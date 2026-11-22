import { useEffect, useId, useState } from 'react';
import Modal from '../common/Modal';
import Spinner from '../common/Spinner';

/** Confirms dropping a student from a class (recorded as DRP) with an optional reason. */
export default function DropEnrollmentDialog({ open, studentName, classLabel, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const id = useId();
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Modal
      open={open}
      title="Drop student from class?"
      onClose={onCancel}
      closeDisabled={busy}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={() => onConfirm(reason.trim())} disabled={busy}>
            {busy && <Spinner size="sm" label="" className="me-2" />}
            Drop student
          </button>
        </>
      }
    >
      <p>
        <strong>{studentName}</strong> will be marked <strong>DRP</strong> (Dropped) in <strong>{classLabel}</strong>.
        Their attendance and scores are kept, and you can reinstate them later.
      </p>
      <label htmlFor={id} className="form-label">Reason (optional)</label>
      <textarea id={id} className="form-control" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Officially dropped before the midterm examination" />
    </Modal>
  );
}
