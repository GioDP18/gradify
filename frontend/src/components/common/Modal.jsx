import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: focus moves inside on open, Tab is trapped, Escape closes,
 * and focus returns to the trigger on close. Uses Bootstrap modal styling without its JS.
 */
export default function Modal({ open, title, onClose, children, footer, size, closeDisabled = false, initialFocusRef }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  // Runs only when the dialog opens/closes, so focus never jumps while it is open.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const first = initialFocusRef?.current ?? dialog?.querySelector(`.modal-body ${FOCUSABLE.split(', ').join(', .modal-body ')}`) ?? dialog?.querySelector(FOCUSABLE);
    first?.focus();
    document.body.classList.add('modal-open');

    function onKeyDown(event) {
      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.stopPropagation();
        onCloseRef.current?.();
      }
      if (event.key === 'Tab' && dialog) {
        const nodes = [...dialog.querySelectorAll(FOCUSABLE)];
        if (nodes.length === 0) return;
        const [firstNode, lastNode] = [nodes[0], nodes[nodes.length - 1]];
        if (event.shiftKey && document.activeElement === firstNode) {
          event.preventDefault();
          lastNode.focus();
        } else if (!event.shiftKey && document.activeElement === lastNode) {
          event.preventDefault();
          firstNode.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialFocusRef is read once on open
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="modal-backdrop show" aria-hidden="true" />
      <div
        className="modal d-block"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !closeDisabled) onClose?.();
        }}
      >
        <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? `modal-${size}` : ''}`} ref={dialogRef}>
          <div className="modal-content evsu-modal">
            <div className="modal-header">
              <h2 className="modal-title h5" id={titleId}>{title}</h2>
              <button type="button" className="btn btn-link text-muted-evsu p-1 ms-auto" onClick={onClose} disabled={closeDisabled} aria-label="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
