import { Inbox, TriangleAlert } from 'lucide-react';
import ActionButton from './ActionButton';

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="evsu-state">
      <span className="evsu-state__icon" aria-hidden="true"><Icon size={24} /></span>
      <h3 className="h6 mb-1">{title}</h3>
      {description && <p className="text-muted-evsu small mb-3">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry }) {
  return (
    <div className="evsu-state" role="alert">
      <span className="evsu-state__icon evsu-state__icon--error" aria-hidden="true"><TriangleAlert size={24} /></span>
      <h3 className="h6 mb-1">{title}</h3>
      <p className="text-muted-evsu small mb-3">{error?.message ?? 'Please try again.'}</p>
      {onRetry && (
        <ActionButton className="btn btn-outline-primary btn-sm" onClick={onRetry}>
          Try again
        </ActionButton>
      )}
    </div>
  );
}

/** Placeholder blocks shown while content loads (avoids layout jumps). */
export function Skeleton({ width = '100%', height = '1rem', className = '' }) {
  return <span className={`evsu-skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonCards({ count = 3 }) {
  return (
    <div className="evsu-grid" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="evsu-card p-4">
          <Skeleton width="40%" />
          <Skeleton width="80%" height="1.25rem" className="mt-2" />
          <Skeleton width="60%" className="mt-3" />
        </div>
      ))}
    </div>
  );
}
