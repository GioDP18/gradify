import { useEffect, useId, useState } from 'react';
import { CircleCheck, Share2, TriangleAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import Modal from '../common/Modal';
import Segmented from '../common/Segmented';
import ActionButton from '../common/ActionButton';
import { useToast } from '../common/Toast';
import * as gradingApi from '../../services/gradingApi';
import { DURATIONS, SCOPES } from './ShareGradeDialog';
import './share.css';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Shares the grading sheets of the students selected on the class sheet, each with that student
 * only (every student gets their own private link). Same choices as for one student: what they
 * can see and for how long, optionally emailing each their link; or stop sharing for all of them.
 */
export default function BulkShareDialog({ open, onClose, classId, students, emailAvailable }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const emailId = useId();
  const [scope, setScope] = useState('all');
  const [duration, setDuration] = useState(168);
  const [email, setEmail] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  // A fresh start each time the dialog opens.
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  const ids = students.map((s) => s.studentId);
  const count = students.length;
  // Stopping is offered only when at least one of them has a link to stop.
  const anyShared = students.some((s) => s.shared);
  const withoutBusy = async (action) => {
    setBusy(true);
    try {
      await action();
      // Each student's own share state (shown on their report page) is now out of date.
      queryClient.invalidateQueries({ queryKey: ['grading-share'] });
      queryClient.invalidateQueries({ queryKey: ['grading'] }); // the sheet marks who has a link
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const share = () => withoutBusy(async () => {
    setResult(await gradingApi.setGradeShareMany(classId, ids, { durationHours: duration, scope, email: email && emailAvailable }));
  });
  const stop = () => withoutBusy(async () => {
    const { stopped } = await gradingApi.stopGradeShareMany(classId, ids);
    toast.success(stopped ? `Sharing stopped for ${plural(stopped, 'student')}. Their links no longer work.` : 'None of the selected students had a shared sheet.');
    onClose();
  });

  const names = students.slice(0, 3).map((s) => s.fullName).join('; ') + (count > 3 ? `; and ${count - 3} more` : '');
  const scopeText = SCOPES.find((s) => s.value === scope).shows;

  return (
    <Modal open={open} title={`Share with ${plural(count, 'student')}`} onClose={onClose} closeDisabled={busy}
      footer={<button type="button" className="btn btn-primary" onClick={onClose} disabled={busy}>{result ? 'Done' : 'Cancel'}</button>}>
      {result ? (
        <div className="evsu-share" role="status">
          <div className="evsu-share__status is-on">
            <CircleCheck size={18} aria-hidden="true" />
            <div>
              <p className="fw-semibold mb-0">{plural(result.shared, 'student')} can now view their own grading sheet</p>
              <p className="small mb-0">
                Showing: {scopeText}. {result.expiresAt
                  ? `Open until ${new Date(result.expiresAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
                  : 'Open with no time limit, until you stop sharing.'}
              </p>
            </div>
          </div>
          {result.emailRequested && result.emailAvailable && <p className="mb-2">{result.emailed === 1 ? '1 email was sent.' : `${result.emailed} emails were sent.`}</p>}
          {result.emailRequested && !result.emailAvailable && (
            <p className="mb-2">No emails were sent: sending email is not set up for Gradify yet. Open each student to copy their link.</p>
          )}
          {!result.emailRequested && <p className="mb-2">No emails were sent. Open a student&rsquo;s report to copy their link or send it.</p>}
          {[['No email address on record', result.noEmail], ['The email could not be sent to', result.emailFailed]].map(([label, list]) => list.length > 0 && (
            <div key={label} className="evsu-share__problem">
              <p className="fw-semibold small mb-1"><TriangleAlert size={14} aria-hidden="true" /> {label} ({list.length})</p>
              <ul className="small mb-0">{list.map((name) => <li key={name}>{name}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="evsu-share">
          <p className="mb-3">
            Each selected student gets a private link to <strong>their own</strong> grading sheet only. No account is needed.
            <span className="d-block small text-muted-evsu mt-1">{names}</span>
          </p>

          <p className="fw-semibold small mb-2">What can they see?</p>
          <Segmented label="What to share" className="evsu-share__durations mb-3">
            {SCOPES.map((s) => (
              <button key={s.value} type="button" aria-pressed={scope === s.value} onClick={() => setScope(s.value)}>{s.label}</button>
            ))}
          </Segmented>

          <p className="fw-semibold small mb-2">How long can they view it?</p>
          <Segmented label="Viewing time" className="evsu-share__durations mb-3">
            {DURATIONS.map((d) => (
              <button key={d.label} type="button" aria-pressed={duration === d.value} onClick={() => setDuration(d.value)}>{d.label}</button>
            ))}
          </Segmented>

          <div className="form-check mb-3">
            <input id={emailId} type="checkbox" className="form-check-input" checked={email && emailAvailable} disabled={!emailAvailable} onChange={(e) => setEmail(e.target.checked)} />
            <label htmlFor={emailId} className="form-check-label">Also send each student their link by email</label>
            <p className="small text-muted-evsu mb-0">
              {emailAvailable
                ? 'Sent to the email address on each student’s record.'
                : 'Sending email is not set up for Gradify yet. You can still share, then copy each link.'}
            </p>
          </div>

          <div className="d-flex flex-wrap gap-2">
            <ActionButton className="btn btn-primary d-inline-flex align-items-center gap-2" icon={Share2} busy={busy} busyLabel={email && emailAvailable ? 'Sharing and sending…' : 'Sharing…'} onClick={share}>
              Share with {plural(count, 'student')}
            </ActionButton>
            {anyShared && <button type="button" className="btn btn-outline-danger ms-auto" onClick={stop} disabled={busy}>Stop sharing for these students</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
