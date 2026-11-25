import { RefreshCw } from 'lucide-react';

/**
 * The refresh button of a list page. `refresh` comes from useRefresh(), which the page also
 * reads to show its loading skeleton. The icon spins while loading.
 */
export default function RefreshButton({ refresh, label = 'Refresh list' }) {
  return (
    <button type="button" className="btn btn-light evsu-refresh-btn" onClick={refresh.refresh} disabled={refresh.busy} aria-label={label} title={label}>
      <RefreshCw size={16} aria-hidden="true" className={refresh.busy ? 'spin' : undefined} />
    </button>
  );
}
