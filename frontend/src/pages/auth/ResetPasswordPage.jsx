import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, CircleAlert, CircleCheck, Eye, EyeOff, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Spinner from '../../components/common/Spinner';
import * as authApi from '../../services/authApi';
import { PASSWORD_CHECKS, meetsPasswordRules } from '../../utils/password';

/**
 * Forgot password, step 2: opened from the emailed link, the user chooses a new password.
 *
 * The link's token is taken out of the address bar at once (it moves into this history entry's
 * state), so it is not left in the visible address, bookmarks, or anything that reads the page's
 * address later. It is sent to the server only in request bodies.
 */
export default function ResetPasswordPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = params.token ?? location.state?.resetToken ?? null;
  useEffect(() => {
    if (params.token) navigate('/reset-password', { replace: true, state: { resetToken: params.token } });
  }, [params.token, navigate]);

  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState(null);
  const [linkDead, setLinkDead] = useState(false);
  const check = useQuery({ queryKey: ['reset-link', token], queryFn: () => authApi.checkResetToken(token), enabled: Boolean(token), retry: false, staleTime: Infinity, gcTime: 0 });
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { newPassword: '', confirmPassword: '' } });
  const newPassword = watch('newPassword');
  const type = show ? 'text' : 'password';

  const onSubmit = async (values) => {
    setFormError(null);
    try {
      await authApi.resetPassword(token, values.newPassword);
      setDone(true);
    } catch (error) {
      if (error.code === 'RESET_LINK_INVALID') setLinkDead(true);
      else if (error.details?.some((d) => d.field === 'newPassword')) setError('newPassword', { message: error.details.find((d) => d.field === 'newPassword').message });
      else setFormError(error.message || 'Your password could not be changed. Please try again.');
    }
  };

  if (done) {
    return (
      <>
        <div role="status">
          <span className="lg__notice-icon is-success"><CircleCheck aria-hidden="true" /></span>
          <h1 className="lg__title">Password changed</h1>
          <p className="lg__text">Your account was signed out on every device. Sign in with your new password.</p>
        </div>
        <Link to="/login" replace className="lg__submit">Sign in <ArrowRight aria-hidden="true" /></Link>
      </>
    );
  }

  if (token && check.isPending) {
    return <><div className="text-center py-4"><Spinner label="Checking your link…" /></div></>;
  }

  if (!token || linkDead || check.data === false || check.error) {
    const offline = Boolean(token) && !linkDead && Boolean(check.error);
    return (
      <>
        <div role="alert">
          <span className="lg__notice-icon"><CircleAlert aria-hidden="true" /></span>
          <h1 className="lg__title">{offline ? 'Could not check your link' : 'This link doesn’t work'}</h1>
          <p className="lg__text">
            {offline
              ? check.error.status === 429 ? check.error.message : 'Check your connection and open the link from your email again.'
              : 'Reset links work once and only for 30 minutes. Request a new one and use the newest email.'}
          </p>
        </div>
        <Link to="/forgot-password" className="lg__submit">Request a new link <ArrowRight aria-hidden="true" /></Link>
        <p className="lg__back"><Link to="/login" className="lg__link">Back to sign in</Link></p>
      </>
    );
  }

  return (
    <>
      <h1 className="lg__title">Choose a new password</h1>
      <p className="lg__subtitle">You&rsquo;ll be signed out on every device and sign in again with it.</p>

      {formError && (
        <div className="alert alert-danger lg__alert d-flex gap-2 align-items-start" role="alert">
          <CircleAlert className="lg__alert-icon flex-shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="lg__field">
          <label htmlFor="new-password" className="visually-hidden">New password</label>
          <Lock className="lg__icon" fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
          <input
            id="new-password"
            type={type}
            placeholder="New password"
            autoComplete="new-password"
            className={`lg__input lg__input--password ${errors.newPassword ? 'is-invalid' : ''}`}
            aria-invalid={Boolean(errors.newPassword)}
            aria-describedby={`new-password-rules${errors.newPassword ? ' new-password-error' : ''}`}
            {...register('newPassword', { validate: (v) => meetsPasswordRules(v) || 'The new password does not meet all the requirements below.' })}
          />
          <button type="button" className="lg__eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide passwords' : 'Show passwords'} aria-pressed={show}>
            {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
          {errors.newPassword && <div id="new-password-error" className="lg__error">{errors.newPassword.message}</div>}
        </div>

        <div className="lg__field">
          <label htmlFor="confirm-password" className="visually-hidden">Confirm new password</label>
          <Lock className="lg__icon" fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
          <input
            id="confirm-password"
            type={type}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className={`lg__input ${errors.confirmPassword ? 'is-invalid' : ''}`}
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
            {...register('confirmPassword', { validate: (v, all) => v === all.newPassword || 'The passwords do not match.' })}
          />
          {errors.confirmPassword && <div id="confirm-password-error" className="lg__error">{errors.confirmPassword.message}</div>}
        </div>

        <ul id="new-password-rules" className="lg__rules" aria-label="Password requirements">
          {PASSWORD_CHECKS.map((c) => {
            const met = c.test(newPassword);
            return (
              <li key={c.label} className={met ? 'is-met' : ''}>
                <span className="lg__rule-mark" aria-hidden="true">{met && <Check size={11} strokeWidth={3} />}</span>
                {c.label}<span className="visually-hidden">{met ? ' (met)' : ' (not yet)'}</span>
              </li>
            );
          })}
        </ul>

        <button type="submit" className="lg__submit" disabled={isSubmitting}>
          {isSubmitting ? <><Spinner size="sm" label="" /> Changing…</> : <>Change password <ArrowRight aria-hidden="true" /></>}
        </button>
      </form>

      <p className="lg__back"><Link to="/login" className="lg__link">Back to sign in</Link></p>
    </>
  );
}
