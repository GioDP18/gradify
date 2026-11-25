import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Spinner from '../../components/common/Spinner';
import logo from '../../assets/brand/gradify-logo-clear.webp';
import campus from '../../assets/brand/evsu-campus-photo.webp';
import './auth.css';

/*
 * The ribbons, traced from the design (1672×941) and drawn in its coordinates:
 *  - top: two gold ribbons with a darker amber stripe between them, under a maroon sliver that
 *    ends two-thirds across (the top-right corner stays cream);
 *  - along the photo: the main gold ribbon narrows to a point about a third of the way down;
 *  - bottom: a gold ribbon leaves the edge and sweeps to the bottom left, with a maroon band
 *    between it and the cream. Both of its edges start on the main (cream) edge line and leave it
 *    in that line's own direction, so the gold grows out of the line as a hairline and widens
 *    smoothly; the shapes run past the line and are clipped exactly to it.
 * Each edge is a smooth curve fitted (least squares) to points measured from the design image,
 * within ~2 px of them; colours are sampled from it.
 */
const RIBBON_PATHS = {
  "cream": "M1364 0 C1276.3 10.3 1185.1 22.6 1104 60 C1097.3 63.1 1040.6 100 1036 104 C1020.6 117.5 1017.4 144 1009 162 C983.1 217.6 965.9 280.6 961 342 C942.1 579.6 941.3 772.1 757 941 L1672 941 L1672 0 Z",
  "photoSide": "M0 0 L1364 0 C1276.3 10.3 1185.1 22.6 1104 60 C1097.3 63.1 1040.6 100 1036 104 C1020.6 117.5 1017.4 144 1009 162 C983.1 217.6 965.9 280.6 961 342 C942.1 579.6 941.3 772.1 757 941 L0 941 Z",
  "maroonTop": "M1201 0 L1364 0 C1276.3 10.3 1185.1 22.6 1104 60 L1104 60 C1112.8 42.4 1181.2 9.9 1201 0 Z",
  "goldTop": "M1059 0 C996.9 74.5 965.5 153.8 959 252 C957 282.1 953.2 312.6 961 342 L961 342 C965.9 280.6 983.1 217.6 1009 162 C1017.4 144 1020.6 117.5 1036 104 C1040.6 100 1097.3 63.1 1104 60 C1112.8 42.4 1181.2 9.9 1201 0 Z",
  "stripe": "M1100 0 C997.7 102.3 976 186 960 330 C970.9 264.9 989.1 155.7 1031 104 C1066.8 59.7 1112.6 29 1161 0 Z",
  "maroonBottom": "M919.3 675 C860.1 854.1 578.5 900.7 420 946 L1000 990 L1000 675 Z",
  "goldBottom": "M936 600 C921.8 671.2 875.8 740.2 815 780 C657.9 883 413.6 910.5 230 946 L420 946 C578.5 900.7 860.1 854.1 919.3 675 L1000 675 L1000 600 Z"
};

function Ribbons() {
  return (
    <svg className="lg__ribbons" viewBox="0 0 1672 941" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lg-cream" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fcf6f2" />
          <stop offset="0.5" stopColor="#fdf9f7" />
          <stop offset="1" stopColor="#fdfaf7" />
        </linearGradient>
        <linearGradient id="lg-gold-top" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="340">
          <stop offset="0" stopColor="#fdd159" />
          <stop offset="0.35" stopColor="#eeb942" />
          <stop offset="1" stopColor="#e6ae3b" />
        </linearGradient>
        <linearGradient id="lg-maroon-top" gradientUnits="userSpaceOnUse" x1="1364" y1="0" x2="1113" y2="52">
          <stop offset="0" stopColor="#7b040d" />
          <stop offset="1" stopColor="#740001" />
        </linearGradient>
        <linearGradient id="lg-gold-bottom" gradientUnits="userSpaceOnUse" x1="930" y1="642" x2="255" y2="941">
          <stop offset="0" stopColor="#f5ba3e" />
          <stop offset="0.2" stopColor="#fccb51" />
          <stop offset="0.4" stopColor="#fac448" />
          <stop offset="0.62" stopColor="#d6922c" />
          <stop offset="0.85" stopColor="#bf7320" />
          <stop offset="1" stopColor="#b2621a" />
        </linearGradient>
        <linearGradient id="lg-maroon-bottom" gradientUnits="userSpaceOnUse" x1="870" y1="780" x2="600" y2="941">
          <stop offset="0" stopColor="#88040e" />
          <stop offset="0.55" stopColor="#78030c" />
          <stop offset="1" stopColor="#6d030b" />
        </linearGradient>
        {/* The photo side of the cream edge: the bottom ribbon and band end exactly on it. */}
        <clipPath id="lg-photo-side" clipPathUnits="userSpaceOnUse">
          <path d={RIBBON_PATHS.photoSide} />
        </clipPath>
      </defs>
      <path d={RIBBON_PATHS.cream} fill="url(#lg-cream)" />
      <path d={RIBBON_PATHS.maroonTop} fill="url(#lg-maroon-top)" />
      <path d={RIBBON_PATHS.goldTop} fill="url(#lg-gold-top)" />
      <path d={RIBBON_PATHS.stripe} fill="#da8818" />
      <g clipPath="url(#lg-photo-side)">
        <path d={RIBBON_PATHS.maroonBottom} fill="url(#lg-maroon-bottom)" />
        <path d={RIBBON_PATHS.goldBottom} fill="url(#lg-gold-bottom)" />
      </g>
    </svg>
  );
}

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
    <div className="lg">
      {/* Left: campus photo, warmed and fading into maroon, with the welcome message */}
      <div className="lg__photo" aria-hidden="true">
        <img src={campus} alt="" width="1800" height="1011" />
      </div>
      <Ribbons />

      <section className="lg__hero" aria-label="Eastern Visayas State University">
        <p className="lg__kicker">Eastern Visayas State University • Since 1907</p>
        <span className="lg__rule" aria-hidden="true" />
        <p className="lg__headline">
          Your class records,<br />
          <em>made simpler.</em>
        </p>
        <p className="lg__intro">Record attendance and scores, compute grades,<br />and keep every class in one place.</p>
        <p className="lg__values">Excellence • Virtue • Service • Unity</p>
      </section>

      {/* Right: the sign-in card */}
      <main className="lg__side">
        <div className="lg__card">
          <img src={logo} alt="Gradify, EVSU Grading System" className="lg__logo" width="560" height="560" />
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
              <button type="button" className="lg__link" aria-expanded={showHelp} aria-controls="login-help" onClick={() => setShowHelp((v) => !v)}>
                Forgot password?
              </button>
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
          {/* There is no self-service reset or support desk: the administrator sets passwords (D23). */}
          <div id="login-help" role="status">
            {showHelp && (
              <p className="lg__help">
                Ask your Gradify administrator to set a new password for you. You can then change it on <strong>My profile</strong>.
              </p>
            )}
          </div>
        </div>

        <footer className="lg__footer">
          <span>© {new Date().getFullYear()} GRADIFY • EVSU Grading System</span>
          <span className="lg__footer-sep" aria-hidden="true" />
          <span className="lg__secure"><ShieldCheck fill="currentColor" stroke="#fff" aria-hidden="true" /> Secure instructor access</span>
        </footer>
      </main>
    </div>
  );
}
