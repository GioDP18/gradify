import Modal from './Modal';
import Spinner from './Spinner';

/** Confirmation step for consequential actions (archive, delete, discard changes). */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      closeDisabled={busy}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn btn-${tone}`} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner size="sm" className="me-2" label="" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-body">{message}</div>
    </Modal>
  );
}
