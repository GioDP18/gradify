import { useEffect } from 'react';
import { loadingProgress } from '../../services/loadingProgress';

export default function Spinner({ size, label = 'Loading…', className = '' }) {
  return (
    <span className={`d-inline-flex align-items-center ${className}`} role={label ? 'status' : undefined}>
      <span className={`spinner-border ${size === 'sm' ? 'spinner-border-sm' : ''}`} aria-hidden="true" />
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  );
}

export function FullPageSpinner({ label = 'Loading…' }) {
  // Shown while a page's code downloads or the session is restored: the top bar runs meanwhile.
  useEffect(() => {
    loadingProgress.start();
    return () => loadingProgress.done();
  }, []);
  return (
    <div className="d-flex align-items-center justify-content-center gap-2 text-muted-evsu" style={{ minHeight: '60vh' }}>
      <Spinner label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}
