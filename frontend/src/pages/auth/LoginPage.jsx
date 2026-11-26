import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Spinner from '../../components/common/Spinner';

export default function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { identifier: '', password: '', remember: false } });

  const onSubmit = async (values) => {
    setFormError(null);
    try {
      await login(values);
      const destination = location.state?.from && location.state.from !== '/login' ? location.state.from : '/';
      navigate(destination, { replace: true });
    } catch (error) {
      setFormError(error.message || 'Sign-in failed. Please try again.');
    }
  };

  return (
    <>
          <h1 className="lg__title">Welcome back</h1>
          <p className="lg__subtitle">Sign in to your instructor account</p>

          {sessionExpired && !formError && (
            <div className="alert alert-warning lg__alert" role="status">Your session has expired. Please sign in again.</div>
          )}
          {formError && (
            <div className="alert alert-danger lg__alert d-flex gap-2 align-items-start" role="alert">
              <CircleAlert className="lg__alert-icon flex-shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="lg__field">
              <label htmlFor="identifier" className="visually-hidden">Email or username</label>
              <User className="lg__icon" fill="currentColor" strokeWidth={1} aria-hidden="true" />
              <input
                id="identifier"
                type="text"
                placeholder="Username or Email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                className={`lg__input ${errors.identifier ? 'is-invalid' : ''}`}
                aria-invalid={Boolean(errors.identifier)}
                aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                {...register('identifier', { validate: (value) => value.trim().length > 0 || 'Enter your email or username.' })}
              />
              {errors.identifier && <div id="identifier-error" className="lg__error">{errors.identifier.message}</div>}
            </div>

            <div className="lg__field">
              <label htmlFor="password" className="visually-hidden">Password</label>
              <Lock className="lg__icon" fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                autoComplete="current-password"
                className={`lg__input lg__input--password ${errors.password ? 'is-invalid' : ''}`}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password', { required: 'Enter your password.' })}
              />
              <button
                type="button"
                className="lg__eye"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
              {errors.password && <div id="password-error" className="lg__error">{errors.password.message}</div>}
            </div>

            <div className="lg__row">
              <label className="lg__check" htmlFor="remember">
                <input id="remember" type="checkbox" {...register('remember')} />
                <span>Remember me</span>
              </label>
              <Link to="/forgot-password" className="lg__link">Forgot password?</Link>
            </div>

            <button type="submit" className="lg__submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Spinner size="sm" label="" /> Signing in…</>
              ) : (
                <>Sign in <ArrowRight aria-hidden="true" /></>
              )}
            </button>
          </form>

          <p className="lg__help-line">
            <span>Need help signing in? </span>
            <button type="button" className="lg__link" aria-expanded={showHelp} aria-controls="login-help" onClick={() => setShowHelp((v) => !v)}>
              Contact support
            </button>
          </p>
          {/* There is no support desk: besides the emailed reset link, the administrator can set passwords (D23). */}
          <div id="login-help" role="status">
            {showHelp && (
              <p className="lg__help">
                Use <Link to="/forgot-password">Forgot password?</Link> to get a reset link by email. If you can no longer open that email, ask your Gradify administrator to set a new password for you.
              </p>
            )}
          </div>
    </>
  );
}
