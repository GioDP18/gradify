import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from './States';

/** Statistic card. With `to`, the whole card links to the related module. */
export default function StatCard({ label, value, hint, icon: Icon, tone = 'primary', to, loading = false }) {
  const body = (
    <>
      <div className="d-flex align-items-start justify-content-between gap-2">
        <span className="small text-muted-evsu fw-semibold">{label}</span>
        {Icon && <span className={`evsu-stat-icon evsu-stat-icon--${tone}`} aria-hidden="true"><Icon size={16} /></span>}
      </div>
      {loading ? <Skeleton width="50%" height="1.75rem" className="mt-2" /> : <div className="evsu-stat-value">{value}</div>}
      <div className="d-flex align-items-center justify-content-between small text-muted-evsu">
        <span>{hint}</span>
        {to && <ChevronRight size={14} aria-hidden="true" />}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="evsu-card evsu-stat-card evsu-stat-card--link p-3" aria-label={`${label}: ${value}${hint ? `, ${hint}` : ''}`}>
      {body}
    </Link>
  ) : (
    <div className="evsu-card evsu-stat-card p-3">{body}</div>
  );
}
