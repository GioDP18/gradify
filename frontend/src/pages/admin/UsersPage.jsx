import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, RefreshCw, UserPlus, Users } from 'lucide-react';
import * as adminApi from '../../services/adminApi';
import { useToast } from '../../components/common/Toast';
import Modal from '../../components/common/Modal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Spinner from '../../components/common/Spinner';
import { TextField, applyServerErrors } from '../../components/common/FormField';
import { EmptyState, ErrorState, Skeleton } from '../../components/common/States';
import { generatePassword, meetsPasswordRules } from '../../utils/password';
import './admin.css';

const accountsKey = ['admin', 'accounts'];

/** Sign-in details to hand to the instructor, shown once after creating an account or setting a password. */
function SignInDetails({ account, password }) {
  const toast = useToast();
  const text = `Gradify sign-in\nEmail: ${account.email}${account.username ? `\nUsername: ${account.username}` : ''}\nTemporary password: ${password}\nPlease change it on My profile after signing in.`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Sign-in details copied.');
    } catch {
      toast.error('Could not copy. Select the details and copy them manually.');
    }
  };
  return (
    <div className="evsu-signin-details">
      <p className="small mb-2">Give these details to <strong>{account.name}</strong>. The password is not shown again.</p>
      <dl className="evsu-signin-details__list mb-3">
        <div><dt>Email</dt><dd>{account.email}</dd></div>
        {account.username && <div><dt>Username</dt><dd>{account.username}</dd></div>}
        <div><dt>Temporary password</dt><dd><code>{password}</code></dd></div>
      </dl>
      <button type="button" className="btn btn-light btn-sm" onClick={copy}><Copy size={14} aria-hidden="true" /> Copy sign-in details</button>
      <p className="small text-muted-evsu mt-3 mb-0">Ask them to change it on <strong>My profile</strong> after signing in.</p>
    </div>
  );
}

/** Password field with a Generate button (strong temporary passwords). */
function PasswordField({ register, setValue, error }) {
  return (
    <div className="evsu-password-gen">
      <TextField label="Temporary password" required autoComplete="new-password" spellCheck="false" error={error}
        hint="At least 12 characters with upper- and lowercase letters, a number, and a symbol."
        {...register('password', { validate: (v) => meetsPasswordRules(v) || 'Use at least 12 characters with upper- and lowercase letters, a number, and a symbol.' })} />
      <button type="button" className="btn btn-light btn-sm evsu-password-gen__btn" onClick={() => setValue('password', generatePassword(), { shouldValidate: true, shouldDirty: true })}>
        <RefreshCw size={14} aria-hidden="true" /> Generate
      </button>
    </div>
  );
}

function AddInstructorDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState(null); // { account, password }
  const [formError, setFormError] = useState(null);
  const { register, handleSubmit, setValue, setError, reset, formState: { errors, isSubmitting } } = useForm({
    defaultValues: { name: '', email: '', username: '', password: generatePassword() },
  });
  const close = () => {
    setCreated(null);
    setFormError(null);
    reset({ name: '', email: '', username: '', password: generatePassword() });
    onClose();
  };
  const onSubmit = async (values) => {
    setFormError(null);
    try {
      const account = await adminApi.createInstructor({ ...values, username: values.username.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: accountsKey });
      setCreated({ account, password: values.password });
    } catch (error) {
      if (!applyServerErrors(error, setError, ['name', 'email', 'username', 'password'])) setFormError(error.message);
    }
  };
  return (
    <Modal open={open} title={created ? 'Instructor account created' : 'Add instructor'} onClose={close} closeDisabled={isSubmitting}
      footer={created ? (
        <button type="button" className="btn btn-primary" onClick={close}>Done</button>
      ) : (
        <>
          <button type="button" className="btn btn-light" onClick={close} disabled={isSubmitting}>Cancel</button>
          <button type="submit" form="add-instructor" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <><Spinner size="sm" label="" /> Creating…</> : 'Create account'}
          </button>
        </>
      )}>
      {created ? (
        <SignInDetails account={created.account} password={created.password} />
      ) : (
        <form id="add-instructor" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError && <div className="alert alert-danger small" role="alert">{formError}</div>}
          <TextField label="Full name" required autoComplete="off" error={errors.name?.message}
            {...register('name', { validate: (v) => v.trim().length > 0 || 'Enter the instructor’s name.' })} />
          <TextField label="Email" type="email" required autoComplete="off" error={errors.email?.message}
            {...register('email', { validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Enter a valid email address.' })} />
          <TextField label="Username" autoComplete="off" autoCapitalize="none" spellCheck="false" error={errors.username?.message}
            hint="Optional. They can sign in with their email or this username."
            {...register('username', { validate: (v) => v.trim() === '' || /^[a-zA-Z0-9._-]{3,40}$/.test(v.trim()) || 'Use 3–40 letters, numbers, dots, dashes, or underscores.' })} />
          <PasswordField register={register} setValue={setValue} error={errors.password?.message} />
        </form>
      )}
    </Modal>
  );
}

function SetPasswordDialog({ account, onClose }) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(null); // the password that was set
  const [formError, setFormError] = useState(null);
  const { register, handleSubmit, setValue, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { password: generatePassword() } });
  const onSubmit = async ({ password }) => {
    setFormError(null);
    try {
      await adminApi.setAccountPassword(account.id, password);
      await queryClient.invalidateQueries({ queryKey: accountsKey });
      setDone(password);
    } catch (error) {
      if (!applyServerErrors(error, setError, ['password'])) setFormError(error.message);
    }
  };
  return (
    <Modal open title={done ? 'New password set' : `Set a new password for ${account.name}`} onClose={onClose} closeDisabled={isSubmitting}
      footer={done ? (
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      ) : (
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={isSubmitting}>Cancel</button>
          <button type="submit" form="set-password" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <><Spinner size="sm" label="" /> Saving…</> : 'Set password'}
          </button>
        </>
      )}>
      {done ? (
        <SignInDetails account={account} password={done} />
      ) : (
        <form id="set-password" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError && <div className="alert alert-danger small" role="alert">{formError}</div>}
          <p className="small text-muted-evsu">Use this when {account.name} forgets their password. It also unlocks the account and signs them out of every device.</p>
          <PasswordField register={register} setValue={setValue} error={errors.password?.message} />
        </form>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({ queryKey: accountsKey, queryFn: adminApi.listAccounts });
  const [adding, setAdding] = useState(false);
  const [settingPassword, setSettingPassword] = useState(null);
  const [toggling, setToggling] = useState(null); // account to disable/enable
  const status = useMutation({
    mutationFn: ({ id, next }) => adminApi.setAccountStatus(id, next),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: accountsKey });
      toast.success(account.status === 'DISABLED' ? `${account.name} can no longer sign in.` : `${account.name} can sign in again.`);
      setToggling(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const instructors = (data ?? []).filter((u) => u.role === 'INSTRUCTOR');
  const admins = (data ?? []).filter((u) => u.role === 'ADMIN');
  const disabling = toggling?.status === 'ACTIVE';

  return (
    <>
      <div className="evsu-page-header">
        <p className="text-muted-evsu mb-0">Instructors can only sign in with an account you create here. There is no public sign-up.</p>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" /> Add instructor</button>
      </div>

      {error && <div className="evsu-card"><ErrorState title="Could not load the accounts" error={error} onRetry={refetch} /></div>}
      {isPending && <div className="evsu-card p-4"><Skeleton height="10rem" /></div>}

      {data && (instructors.length === 0 ? (
        <div className="evsu-card">
          <EmptyState icon={Users} title="No instructor accounts yet" description="Create an account for each instructor. They sign in with the email (or username) and the temporary password you give them."
            action={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" /> Add instructor</button>} />
        </div>
      ) : (
        <div className="evsu-table-wrap">
          <table className="table evsu-table align-middle">
            <caption className="visually-hidden">Instructor accounts</caption>
            <thead>
              <tr>
                <th scope="col">Instructor</th>
                <th scope="col">Username</th>
                <th scope="col" className="text-end">Active classes</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {instructors.map((u) => (
                <tr key={u.id}>
                  <th scope="row" data-label="Instructor">
                    <span className="d-block">{u.name}</span>
                    <span className="d-block small text-muted-evsu fw-normal">{u.email}</span>
                  </th>
                  <td data-label="Username">{u.username ?? '—'}</td>
                  <td data-label="Active classes" className="text-end">{u.activeClasses}</td>
                  <td data-label="Status">
                    <span className={`evsu-status ${u.status === 'ACTIVE' ? 'evsu-status--ok' : 'evsu-status--neutral'}`}>{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</span>
                  </td>
                  <td data-label="Last sign-in" className="small">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}</td>
                  <td data-label="" className="text-end text-nowrap">
                    <button type="button" className="btn btn-sm btn-light me-1" onClick={() => setSettingPassword(u)} aria-label={`Set a new password for ${u.name}`}>
                      <KeyRound size={14} aria-hidden="true" /> Set password
                    </button>
                    <button type="button" className={`btn btn-sm ${u.status === 'ACTIVE' ? 'btn-outline-danger' : 'btn-outline-primary'}`} onClick={() => setToggling(u)}
                      aria-label={`${u.status === 'ACTIVE' ? 'Disable' : 'Enable'} ${u.name}`}>
                      {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {admins.length > 0 && (
        <p className="small text-muted-evsu mt-3 mb-0">
          Administrator account{admins.length === 1 ? '' : 's'}: {admins.map((a) => a.email).join(', ')}. Administrators manage accounts and grading criteria and have no classes.
        </p>
      )}

      <AddInstructorDialog open={adding} onClose={() => setAdding(false)} />
      {settingPassword && <SetPasswordDialog account={settingPassword} onClose={() => setSettingPassword(null)} />}
      <ConfirmDialog
        open={Boolean(toggling)}
        title={disabling ? `Disable ${toggling?.name}?` : `Enable ${toggling?.name}?`}
        message={disabling
          ? 'They are signed out everywhere and cannot sign in until you enable the account again. Their classes, students, and grades are kept.'
          : 'They can sign in again with their current password.'}
        confirmLabel={status.isPending ? 'Saving…' : disabling ? 'Disable account' : 'Enable account'}
        tone={disabling ? 'danger' : 'primary'}
        busy={status.isPending}
        onConfirm={() => status.mutate({ id: toggling.id, next: disabling ? 'DISABLED' : 'ACTIVE' })}
        onCancel={() => setToggling(null)}
      />
    </>
  );
}
