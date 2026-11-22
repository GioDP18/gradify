import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Check, CircleAlert, Expand, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import Avatar, { useAvatarSrc } from '../../components/common/Avatar';
import Modal from '../../components/common/Modal';
import { Skeleton } from '../../components/common/States';
import { toSquareAvatar, ACCEPTED_IMAGE_TYPES } from '../../utils/resizeImage';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/common/Toast';
import { TextField, applyServerErrors } from '../../components/common/FormField';
import Spinner from '../../components/common/Spinner';
import { useUnsavedChangesPrompt } from '../../hooks/useUnsavedChangesPrompt';
import * as authApi from '../../services/authApi';
import './profile.css';

/** Same rules the server enforces (backend utils/password.js). */
const PASSWORD_CHECKS = [
  { label: 'At least 12 characters', test: (p) => p.length >= 12 },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /\d/.test(p) },
  { label: 'A symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/**
 * The profile photo at full size. With a `pending` photo (just chosen, not yet uploaded) it is a
 * preview: nothing is saved until the user presses Save; Cancel or closing discards it.
 */
function PhotoViewer({ open, user, busy, pending, onClose, onChange, onRemove, onSave, onCancel }) {
  const saved = useAvatarSrc(user);
  const src = pending?.url ?? saved;
  const saving = busy === 'upload';
  const locked = saving || busy === 'remove';
  return (
    <Modal
      open={open}
      title={pending ? 'New profile photo' : 'Profile photo'}
      onClose={pending ? onCancel : onClose}
      closeDisabled={locked}
      footer={pending ? (
        <>
          <button type="button" className="btn btn-light me-auto" onClick={onChange} disabled={locked}>Choose another</button>
          <button type="button" className="btn btn-light" onClick={onCancel} disabled={locked}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={locked}>
            {saving ? <><Spinner size="sm" label="" /> Saving…</> : 'Save'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-light me-auto" onClick={onRemove} disabled={locked}>
            {busy === 'remove' ? 'Removing…' : 'Remove photo'}
          </button>
          <button type="button" className="btn btn-light" onClick={onChange} disabled={locked}>Change photo</button>
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={locked}>Close</button>
        </>
      )}
    >
      <figure className="evsu-photo-viewer mb-0">
        {src ? (
          <div className="evsu-photo-viewer__frame">
            <img src={src} alt={pending ? 'Preview of your new profile photo' : `Profile photo of ${user.name}`} className="evsu-photo-viewer__img" />
            {/* On hover: the circle the avatar shows, with the cropped-away corners dimmed. */}
            <span className="evsu-photo-viewer__circle" aria-hidden="true" />
          </div>
        ) : (
          <Skeleton width="100%" height="100%" className="evsu-photo-viewer__img" />
        )}
        <figcaption className="evsu-photo-viewer__caption">
          {pending ? (
            <span className="text-muted-evsu small">This is how your photo will look. Press Save to use it.</span>
          ) : (
            <>
              <span className="fw-semibold">{user.name}</span>
              <span className="text-muted-evsu small">{user.email}</span>
            </>
          )}
        </figcaption>
      </figure>
    </Modal>
  );
}

/** Profile photo: the avatar opens the viewer (or the file picker when there is no photo yet). */
function PhotoControl({ user }) {
  const { updateUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef(null);
  const [busy, setBusy] = useState(null); // 'prepare' | 'upload' | 'remove'
  const [viewing, setViewing] = useState(false);
  const [pending, setPending] = useState(null); // { blob, url } — chosen but not saved
  const hasPhoto = Boolean(user.avatarUpdatedAt);

  // Release the preview's memory when it is replaced or the page closes.
  useEffect(() => () => pending && URL.revokeObjectURL(pending.url), [pending]);

  const choose = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // choosing the same file again still triggers a change
    if (!file) return;
    setBusy('prepare');
    try {
      const blob = await toSquareAvatar(file);
      setPending({ blob, url: URL.createObjectURL(blob) });
      setViewing(true);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    setPending(null);
    if (!hasPhoto) setViewing(false); // with a photo, go back to viewing it
  };

  const save = async () => {
    if (!pending) return;
    setBusy('upload');
    try {
      const saved = await authApi.uploadAvatar(pending.blob);
      // Show the new photo everywhere at once, without downloading what was just uploaded.
      queryClient.setQueryData(['avatar', saved.id, saved.avatarUpdatedAt], pending.blob);
      updateUser(saved);
      setPending(null);
      setViewing(false);
      toast.success('Profile photo updated.');
    } catch (error) {
      toast.error(error.message); // the preview stays open so Save can be tried again
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      updateUser(await authApi.removeAvatar());
      toast.success('Profile photo removed.');
      setViewing(false);
    } catch (error) {
      toast.error(error.message); // the viewer stays open with the error
    } finally {
      setBusy(null);
    }
  };

  const pick = () => input.current?.click();

  return (
    <div className="evsu-profile__photo">
      {/* With a photo, the avatar opens it in full; without one, it asks for one. */}
      <button type="button" className="evsu-profile__avatar-btn" onClick={hasPhoto ? () => setViewing(true) : pick} disabled={Boolean(busy)} aria-label={hasPhoto ? 'View profile photo' : 'Upload a profile photo'}>
        <Avatar user={user} className="evsu-profile__avatar" />
        <span className="evsu-profile__avatar-overlay" aria-hidden="true">
          {busy === 'prepare' ? <Spinner size="sm" label="" /> : hasPhoto ? <Expand size={18} /> : <Camera size={18} />}
        </span>
      </button>
      <PhotoViewer
        open={viewing && (hasPhoto || Boolean(pending))}
        user={user}
        busy={busy}
        pending={pending}
        onClose={() => setViewing(false)}
        onChange={pick}
        onRemove={remove}
        onSave={save}
        onCancel={cancel}
      />
      <input ref={input} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={choose} data-testid="avatar-input" />
    </div>
  );
}

function SectionHeading({ icon: Icon, id, title, description }) {
  return (
    <div className="evsu-profile__section-head">
      <span className="evsu-profile__section-icon" aria-hidden="true"><Icon size={18} /></span>
      <div>
        <h2 id={id} className="h5 mb-1">{title}</h2>
        <p className="small text-muted-evsu mb-0">{description}</p>
      </div>
    </div>
  );
}

function ProfileForm({ user }) {
  const { updateUser } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState(null);
  const defaults = { name: user.name, email: user.email, username: user.username ?? '', currentPassword: '' };
  const { register, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm({ defaultValues: defaults });

  const email = watch('email');
  const username = watch('username');
  // Email and username are how you sign in, so changing them asks for your password.
  const signInChanged = email.trim().toLowerCase() !== user.email || username.trim().toLowerCase() !== (user.username ?? '');
  useUnsavedChangesPrompt(isDirty);

  const onSubmit = async (values) => {
    setFormError(null);
    try {
      const saved = await authApi.updateProfile({
        name: values.name,
        email: values.email,
        username: values.username,
        ...(signInChanged ? { currentPassword: values.currentPassword } : {}),
      });
      updateUser(saved);
      reset({ name: saved.name, email: saved.email, username: saved.username ?? '', currentPassword: '' });
      toast.success('Profile saved.');
    } catch (error) {
      if (!applyServerErrors(error, setError, ['name', 'email', 'username', 'currentPassword'])) setFormError(error.message);
    }
  };

  return (
    <section className="evsu-card p-4 p-md-5" aria-labelledby="profile-details">
      <SectionHeading icon={UserRound} id="profile-details" title="Profile details" description="Your name appears in the app and on printed grade reports." />
      {formError && <div className="alert alert-danger small d-flex gap-2" role="alert"><CircleAlert size={16} className="mt-1 flex-shrink-0" aria-hidden="true" />{formError}</div>}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="evsu-profile__form">
        <TextField label="Full name" required autoComplete="name" error={errors.name?.message}
          {...register('name', { validate: (v) => v.trim().length > 0 || 'Enter your name.' })} />
        <div className="evsu-profile__pair">
          <TextField label="Email" type="email" required autoComplete="email" error={errors.email?.message}
            {...register('email', { validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Enter a valid email address.' })} />
          <TextField label="Username" autoComplete="username" autoCapitalize="none" spellCheck="false" error={errors.username?.message}
            hint="Optional. You can sign in with your email or this username."
            {...register('username', { validate: (v) => v.trim() === '' || /^[a-zA-Z0-9._-]{3,40}$/.test(v.trim()) || 'Use 3–40 letters, numbers, dots, dashes, or underscores.' })} />
        </div>
        {signInChanged && (
          <div className="evsu-profile__confirm">
            <TextField label="Current password" type="password" required autoComplete="current-password" error={errors.currentPassword?.message}
              hint="You're changing how you sign in, so confirm it's you."
              {...register('currentPassword', { validate: (v) => !signInChanged || v.length > 0 || 'Enter your current password.' })} />
          </div>
        )}
        <div className="d-flex flex-wrap gap-2 justify-content-end">
          <button type="button" className="btn btn-light" onClick={() => { reset(defaults); setFormError(null); }} disabled={!isDirty || isSubmitting}>Discard changes</button>
          <button type="submit" className="btn btn-primary" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? <><Spinner size="sm" label="" /> Saving…</> : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState(null);
  const { register, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const newPassword = watch('newPassword');
  const type = show ? 'text' : 'password';

  const onSubmit = async ({ currentPassword, newPassword: next }) => {
    setFormError(null);
    try {
      const { otherSessionsSignedOut } = await authApi.changePassword({ currentPassword, newPassword: next });
      reset();
      toast.success(otherSessionsSignedOut ? `Password changed. Signed out ${otherSessionsSignedOut} other session${otherSessionsSignedOut === 1 ? '' : 's'}.` : 'Password changed.');
    } catch (error) {
      if (!applyServerErrors(error, setError, ['currentPassword', 'newPassword'])) setFormError(error.message);
    }
  };

  return (
    <section className="evsu-card p-4 p-md-5" aria-labelledby="profile-password">
      <SectionHeading icon={KeyRound} id="profile-password" title="Change password" description="Other browsers and devices are signed out; you stay signed in here." />
      {formError && <div className="alert alert-danger small d-flex gap-2" role="alert"><CircleAlert size={16} className="mt-1 flex-shrink-0" aria-hidden="true" />{formError}</div>}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="evsu-profile__form">
        <TextField label="Current password" type={type} required autoComplete="current-password" error={errors.currentPassword?.message}
          {...register('currentPassword', { required: 'Enter your current password.' })} />
        <div className="evsu-profile__pair">
          <TextField label="New password" type={type} required autoComplete="new-password" error={errors.newPassword?.message}
            {...register('newPassword', { validate: (v) => PASSWORD_CHECKS.every((c) => c.test(v)) || 'The new password does not meet all the requirements below.' })} />
          <TextField label="Confirm new password" type={type} required autoComplete="new-password" error={errors.confirmPassword?.message}
            {...register('confirmPassword', { validate: (v, all) => v === all.newPassword || 'The passwords do not match.' })} />
        </div>
        <ul id="password-rules" className="evsu-profile__rules list-unstyled" aria-label="Password requirements">
          {PASSWORD_CHECKS.map((c) => {
            const met = c.test(newPassword);
            return (
              <li key={c.label} className={met ? 'is-met' : ''}>
                <span className="evsu-profile__rule-mark" aria-hidden="true">{met && <Check size={12} strokeWidth={3} />}</span>
                {c.label}<span className="visually-hidden">{met ? ' (met)' : ' (not yet)'}</span>
              </li>
            );
          })}
        </ul>
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div className="form-check mb-0">
            <input id="show-passwords" type="checkbox" className="form-check-input" checked={show} onChange={(e) => setShow(e.target.checked)} />
            <label htmlFor="show-passwords" className="form-check-label small">Show passwords</label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <><Spinner size="sm" label="" /> Changing…</> : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  const lastLogin = user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div className="evsu-profile">
      <header className="evsu-profile__identity">
        <PhotoControl user={user} />
        <div className="min-w-0">
          <p className="evsu-profile__name">{user.name}</p>
          <p className="evsu-profile__meta">
            <span>{user.email}</span>
            {user.username && <span>@{user.username}</span>}
          </p>
        </div>
        <dl className="evsu-profile__facts">
          <div><dt>Role</dt><dd><ShieldCheck size={14} aria-hidden="true" /> {{ INSTRUCTOR: 'Instructor', ADMIN: 'Administrator' }[user.role] ?? user.role}</dd></div>
          {lastLogin && <div><dt>Last sign-in</dt><dd>{lastLogin}</dd></div>}
        </dl>
      </header>
      {/* Keyed by user so the form resets to the saved values after a save. */}
      <ProfileForm key={`${user.name}|${user.email}|${user.username}`} user={user} />
      <PasswordForm />
    </div>
  );
}
