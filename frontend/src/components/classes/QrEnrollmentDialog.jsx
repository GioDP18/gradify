import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Copy, Download, RefreshCw } from 'lucide-react';
import Modal from '../common/Modal';
import ConfirmDialog from '../common/ConfirmDialog';
import Spinner from '../common/Spinner';
import { useToast } from '../common/Toast';
import { useClassContext, formatClassLabel } from '../../context/ClassContext';
import { classKeys } from '../../hooks/useClasses';
import * as classesApi from '../../services/classesApi';
import './qr.css';

export const joinUrl = (token) => `${window.location.origin}/join/${token}`;

/**
 * QR self-enrollment for one class: the on/off switch, the QR code (download or copy the link),
 * and "New link", which makes earlier QR codes stop working.
 */
export default function QrEnrollmentDialog({ classId, open, onClose }) {
  const { classes } = useClassContext();
  const cls = classes.find((c) => c.id === classId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const switchId = useId();
  const [busy, setBusy] = useState(null); // 'toggle' | 'link'
  const [confirmNewLink, setConfirmNewLink] = useState(false);
  const [qr, setQr] = useState(null);

  const token = cls?.selfEnrollment?.token ?? null;
  const accepting = Boolean(cls?.selfEnrollment?.open);
  const url = token ? joinUrl(token) : null;

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setQr(null);
      return undefined;
    }
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#3a0b11', light: '#ffffff' } })
      .then((data) => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [url]);

  if (!cls) return null;
  const label = formatClassLabel(cls);

  const run = async (kind, action, message) => {
    setBusy(kind);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: classKeys.all });
      toast.success(message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (on) => run('toggle', () => classesApi.setSelfEnrollment(cls.id, on),
    on ? `QR enrollment is open for ${label}.` : `QR enrollment is closed for ${label}.`);
  const newLink = () => run('link', () => classesApi.newSelfEnrollmentLink(cls.id), 'New link created. Earlier QR codes no longer work.')
    .finally(() => setConfirmNewLink(false));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  return (
    <>
      <Modal open={open && !confirmNewLink} title={`QR enrollment: ${label}`} onClose={onClose}
        footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
        <div className="evsu-qr">
          <div className="evsu-qr__switch">
            <div>
              <label htmlFor={switchId} className="fw-semibold mb-0">Accept enrollments</label>
              <p className="small text-muted-evsu mb-0">
                {accepting
                  ? 'Students who scan the code can enroll themselves in this class now.'
                  : 'Closed: students who scan the code are told enrollment is closed.'}
              </p>
            </div>
            <div className="form-check form-switch m-0">
              <input id={switchId} type="checkbox" role="switch" className="form-check-input" checked={accepting}
                disabled={busy === 'toggle' || cls.status !== 'ACTIVE'} onChange={(e) => toggle(e.target.checked)} />
            </div>
          </div>

          {!token ? (
            <p className="evsu-qr__empty">Turn on <strong>Accept enrollments</strong> to create this class&apos;s QR code.</p>
          ) : (
            <>
              <figure className={`evsu-qr__code ${accepting ? '' : 'is-closed'}`}>
                {qr ? <img src={qr} alt={`QR code to enroll in ${label}`} width="280" height="280" /> : <Spinner label="Making the QR code…" />}
                {!accepting && <figcaption className="evsu-qr__closed">Closed</figcaption>}
              </figure>
              <p className="small text-muted-evsu text-center mb-2">
                Students scan this with their phone camera and fill in their student number and name. Each student number can enroll once.
              </p>
              <div className="input-group input-group-sm mb-3">
                <input className="form-control" value={url} readOnly aria-label="Enrollment link" onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-light" onClick={copy}><Copy size={14} aria-hidden="true" /> Copy link</button>
              </div>
              <div className="d-flex flex-wrap gap-2 justify-content-between">
                <a className={`btn btn-light btn-sm ${qr ? '' : 'disabled'}`} href={qr ?? undefined} download={`qr-enroll-${cls.subjectCode}-${cls.section}.png`.replace(/\s+/g, '-')}>
                  <Download size={14} aria-hidden="true" /> Download QR code
                </a>
                <button type="button" className="btn btn-light btn-sm" onClick={() => setConfirmNewLink(true)} disabled={busy === 'link'}>
                  <RefreshCw size={14} aria-hidden="true" /> New link
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmNewLink}
        title="Create a new link?"
        message="The current QR code and link stop working immediately. Share the new QR code with students who still need to enroll."
        confirmLabel={busy === 'link' ? 'Creating…' : 'Create new link'}
        tone="primary"
        busy={busy === 'link'}
        onConfirm={newLink}
        onCancel={() => setConfirmNewLink(false)}
      />
    </>
  );
}
