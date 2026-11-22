import { Database, RefreshCw, Server } from 'lucide-react';
import { useHealth } from '../../hooks/useHealth';
import emblem from '../../assets/brand/gradify-emblem.webp';

function StatusPill({ tone, children }) {
  return <span className={`evsu-status evsu-status--${tone}`}>{children}</span>;
}

function StatusRow({ icon: Icon, label, tone, value, hint }) {
  return (
    <li className="d-flex align-items-center gap-3 py-3 border-top">
      <Icon size={20} aria-hidden="true" className="text-muted-evsu flex-shrink-0" />
      <div className="flex-grow-1">
        <div className="fw-semibold">{label}</div>
        {hint && <div className="small text-muted-evsu">{hint}</div>}
      </div>
      <StatusPill tone={tone}>{value}</StatusPill>
    </li>
  );
}

/**
 * Verifies frontend ↔ backend ↔ database connectivity using real API data.
 */
export default function SystemStatusPage() {
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } = useHealth();

  let api = { tone: 'warn', value: 'Checking…' };
  let database = { tone: 'warn', value: 'Checking…' };

  if (error) {
    api = { tone: 'error', value: 'Unreachable', hint: error.message };
    database = { tone: 'warn', value: 'Unknown' };
  } else if (data) {
    api = { tone: 'ok', value: 'Online' };
    database =
      data.database === 'connected'
        ? { tone: 'ok', value: 'Connected' }
        : { tone: 'error', value: data.database, hint: 'The API is running but cannot reach MongoDB.' };
  }

  return (
    <main className="container py-5" style={{ maxWidth: 640 }}>
      <header className="d-flex align-items-center gap-3 mb-4">
        <img src={emblem} alt="" width="52" height="46" />
        <div>
          <h1 className="h4 mb-0">Gradify</h1>
          <p className="mb-0 text-muted-evsu small">System status</p>
        </div>
      </header>

      <section className="evsu-card p-4" aria-labelledby="status-heading" aria-busy={isPending}>
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h2 id="status-heading" className="h6 mb-0">Connectivity</h2>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-2"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" className={isFetching ? 'spin' : undefined} />
            {isFetching ? 'Checking…' : 'Check again'}
          </button>
        </div>
        <ul className="list-unstyled mb-0">
          <StatusRow icon={Server} label="API server" {...api} />
          <StatusRow icon={Database} label="Database" {...database} />
        </ul>
        {dataUpdatedAt > 0 && (
          <p className="small text-muted-evsu mt-3 mb-0">
            Last checked {new Date(dataUpdatedAt).toLocaleTimeString()}
          </p>
        )}
      </section>
    </main>
  );
}
