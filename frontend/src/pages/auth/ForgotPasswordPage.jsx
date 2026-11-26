import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleAlert, Mail, MailCheck } from 'lucide-react';
import Spinner from '../../components/common/Spinner';
import * as authApi from '../../services/authApi';

/**
 * Forgot password, step 1: the user enters their account's email and is sent a reset link.
 * The page says the same thing whether or not the address has an account, so it cannot be used
 * to find out who has one.
 */
export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState(null);
  const [formError, setFormError] = useState(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: '' } });

  const onSubmit = async ({ email }) => {
    setFormError(null);
    try {
      await authApi.requestPasswordReset(email.trim());
      setSentTo(email.trim());
    } catch (error) {
      setFormError(error.message || 'The request could not be sent. Please try again.');
    }
  };

  if (sentTo) {
    return (
      <>
        <div role="status">
          <span className="lg__notice-icon is-success"><MailCheck aria-hidden="true" /></span>
          <h1 className="lg__title">Check your email</h1>
          <p className="lg__text">
            If an account uses <strong>{sentTo}</strong>, we sent it a link to choose a new password. The link works once and only for 30 minutes.
          </p>
          <p className="lg__help">
            Nothing after a few minutes? Check your spam folder and that the address is the one on your account, then try again.
          </p>
        </div>
        <p className="lg__back">
          <button type="button" className="lg__link" onClick={() => setSentTo(null)}>Use a different email</button>
        </p>
        <p className="lg__back"><Link to="/login" className="lg__link"><ArrowLeft size={14} aria-hidden="true" /> Back to sign in</Link></p>
      </>
    );
  }

  return (
    <>
      <h1 className="lg__title">Forgot your password?</h1>
      <p className="lg__subtitle">Enter the email address of your account and we&rsquo;ll send you a link to choose a new one.</p>

      {formError && (
        <div className="alert alert-danger lg__alert d-flex gap-2 align-items-start" role="alert">
          <CircleAlert className="lg__alert-icon flex-shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="lg__field">
          <label htmlFor="reset-email" className="visually-hidden">Email address</label>
          <Mail className="lg__icon" strokeWidth={1.75} aria-hidden="true" />
          <input
            id="reset-email"
            type="email"
            placeholder="Email address"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck="false"
            className={`lg__input ${errors.email ? 'is-invalid' : ''}`}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'reset-email-error' : undefined}
            {...register('email', { validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Enter the email address of your account.' })}
          />
          {errors.email && <div id="reset-email-error" className="lg__error">{errors.email.message}</div>}
        </div>

        <button type="submit" className="lg__submit" disabled={isSubmitting}>
          {isSubmitting ? <><Spinner size="sm" label="" /> Sending…</> : <>Send reset link <ArrowRight aria-hidden="true" /></>}
        </button>
      </form>

      <p className="lg__back"><Link to="/login" className="lg__link"><ArrowLeft size={14} aria-hidden="true" /> Back to sign in</Link></p>
    </>
  );
}
