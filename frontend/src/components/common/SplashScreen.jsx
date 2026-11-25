import { useEffect } from 'react';
import { loadingProgress } from '../../services/loadingProgress';
import logo from '../../assets/brand/gradify-logo-clear.webp';

/**
 * Whole-screen loading state shown before the app has a page to draw: while the saved session is
 * checked, or a first page's code downloads. The logo breathes inside a turning gold ring and a
 * bar slides underneath, so a slow connection never looks frozen.
 */
export default function SplashScreen({ label = 'Loading…' }) {
  useEffect(() => {
    loadingProgress.start();
    return () => loadingProgress.done();
  }, []);
  return (
    <div className="evsu-splash" role="status" aria-live="polite">
      <div className="evsu-splash__mark" aria-hidden="true">
        <span className="evsu-splash__ring" />
        <span className="evsu-splash__disc">
          <img src={logo} alt="" width="560" height="560" />
        </span>
      </div>
      <p className="evsu-splash__label">{label}</p>
      <span className="evsu-splash__bar" aria-hidden="true"><span /></span>
    </div>
  );
}
