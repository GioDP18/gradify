import { useEffect, useState } from 'react';
import { CircleCheck, Clock, Copy, Mail, Share2 } from 'lucide-react';
import Modal from '../common/Modal';
import Segmented from '../common/Segmented';
import ActionButton from '../common/ActionButton';
import Spinner from '../common/Spinner';
import { useToast } from '../common/Toast';
import { useGradeShare, useGradeShareActions } from '../../hooks/useGrading';
import './share.css';

export const shareUrl = (token) => `${window.location.origin}/my-grades/${token}`;

// How long the student can view the sheet; null = until the instructor stops it.
export const DURATIONS = [
  { value: 24, label: '24 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
  { value: null, label: 'No time limit' },
];
// What the student can see: the whole sheet, or one grade only.
export const SCOPES = [
  { value: 'all', label: 'All', shows: 'Midterm, Finals and Final Grade' },
  { value: 'midterm', label: 'Midterm', shows: 'Midterm only' },
  { value: 'finals', label: 'Finals', shows: 'Finals only' },
  { value: 'overall', label: 'Final Grade', shows: 'Final Grade only' },
];
const dateTime = (value) => new Date(value).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Whether the sheet is being shared right now (a share whose time has ended is not). */
export const isSharing = (share) => Boolean(share && !share.expired);

/**
 * Lets the instructor show one student their own grading sheet through a private link: all of it
 * or one grade only, for a limited time or with no time limit, copied or sent to the student's
 * email, and stopped at any time.
 */
export default function ShareGradeDialog({ open, onClose, classId, studentId, studentName }) {
  const toast = useToast();
  const { data, isPending, error } = useGradeShare(classId, studentId, { enabled: open });
  const actions = useGradeShareActions(classId, studentId);
  const [duration, setDuration] = useState(168);
  const [scope, setScope] = useState('all');
  // Start from what is shared now, so saving a new time limit does not change it by accident.
  const sharedScope = data?.share?.scope;
  useEffect(() => {
    if (sharedScope) setScope(sharedScope);
  }, [sharedScope]);

  const share = data?.share ?? null;
  const active = isSharing(share);
  const email = data?.student.email ?? null;
  const url = share ? shareUrl(share.token) : '';

  const run = async (action, message) => {
    try {
      await action();
      toast.success(message);
    } catch (err) {
      toast.error(err.message);
    }
  };
  const limitText = DURATIONS.find((d) => d.value === duration).label.toLowerCase();
  const what = scope === 'all' ? 'their grading sheet' : `their ${SCOPES.find((s) => s.value === scope).label} grade`.replace('Final Grade grade', 'Final Grade');
  const start = () => run(() => actions.set(duration, scope), duration === null
    ? `${studentName} can now view ${what}.`
    : `${studentName} can view ${what} for ${limitText}.`);
  const stop = () => run(() => actions.stop(), 'Sharing stopped. The link no longer works.');
  const send = () => run(() => actions.email(), `Link sent to ${email}.`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  let emailNote = `Sends the link to ${email}.`;
  if (!email) emailNote = 'This student has no email address on record. Add one in Students, or copy the link.';
  else if (data && !data.emailAvailable) emailNote = 'Sending email is not set up for Gradify yet. Copy the link and send it yourself.';
  else if (share?.emailedAt) emailNote = `Last sent to ${email} on ${dateTime(share.emailedAt)}.`;

  return (
    <Modal open={open} title="Share grading sheet" onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
      {isPending && <div className="text-center py-4"><Spinner label="Loading…" /></div>}
      {error && <p className="text-danger mb-0" role="alert">{error.message}</p>}
      {data && (
        <div className="evsu-share">
          <p className="mb-3">
            Let <strong>{studentName}</strong> see how their grade in this class was computed, through a private link. No account is needed.
          </p>

          {share && (
            <div className={`evsu-share__status ${active ? 'is-on' : 'is-ended'}`} role="status">
              {active ? <CircleCheck size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
              <div>
                <p className="fw-semibold mb-0">{active ? 'The student can view this sheet' : 'Viewing time has ended'}</p>
                {active && <p className="small mb-0">Showing: {(SCOPES.find((s) => s.value === share.scope) ?? SCOPES[0]).shows}.</p>}
                <p className="small mb-0">
                  {!active && `Ended ${dateTime(share.expiresAt)}. Set a new time limit to open it again.`}
                  {active && (share.expiresAt ? `Open until ${dateTime(share.expiresAt)}.` : 'Open with no time limit, until you stop sharing.')}
                </p>
              </div>
            </div>
          )}

          <p className="fw-semibold small mb-2">What can they see?</p>
          <Segmented label="What to share" className="evsu-share__durations mb-3">
            {SCOPES.map((s) => (
              <button key={s.value} type="button" aria-pressed={scope === s.value} onClick={() => setScope(s.value)}>{s.label}</button>
            ))}
          </Segmented>

          <p className="fw-semibold small mb-2">{share ? 'How long from now?' : 'How long can they view it?'}</p>
          <Segmented label="Viewing time" className="evsu-share__durations mb-3">
            {DURATIONS.map((d) => (
              <button key={d.label} type="button" aria-pressed={duration === d.value} onClick={() => setDuration(d.value)}>{d.label}</button>
            ))}
          </Segmented>
          <div className="d-flex flex-wrap gap-2 mb-1">
            <ActionButton className={`btn ${share ? 'btn-light' : 'btn-primary'} d-inline-flex align-items-center gap-2`} icon={share ? Clock : Share2} onClick={start}>
              {share ? 'Save changes' : 'Share with student'}
            </ActionButton>
            {share && (
              <ActionButton className="btn btn-outline-danger d-inline-flex align-items-center gap-2 ms-auto" onClick={stop}>Stop sharing</ActionButton>
            )}
          </div>

          {active && (
            <div className="evsu-share__send">
              <label className="fw-semibold small mb-1" htmlFor="share-link">Private link</label>
              <div className="input-group input-group-sm mb-3">
                <input id="share-link" className="form-control" value={url} readOnly onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-light" onClick={copy}><Copy size={14} aria-hidden="true" /> Copy link</button>
              </div>
              <ActionButton className="btn btn-primary d-inline-flex align-items-center gap-2" icon={Mail} busyLabel="Sending…" onClick={send} disabled={!email || !data.emailAvailable}>
                {share.emailedAt ? 'Send to student’s email again' : 'Send to student’s email'}
              </ActionButton>
              <p className="small text-muted-evsu mt-2 mb-0">{emailNote}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
