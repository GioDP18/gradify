import { useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

/**
 * Reloads a page's list from the server (e.g. students who just enrolled by QR code).
 * `queryKeys`: the cached data to reload, e.g. [['students']]. The icon spins while loading.
 */
export default function RefreshButton({ queryKeys, label = 'Refresh list' }) {
  const queryClient = useQueryClient();
  const [clicked, setClicked] = useState(false);
  const fetching = useIsFetching({ predicate: (q) => queryKeys.some((key) => key.every((part, i) => q.queryKey[i] === part)) }) > 0;
  const busy = clicked && fetching;

  const refresh = async () => {
    setClicked(true);
    try {
      await Promise.all(queryKeys.map((queryKey) => queryClient.refetchQueries({ queryKey, type: 'active' })));
    } finally {
      setClicked(false);
    }
  };

  return (
    <button type="button" className="btn btn-light evsu-refresh-btn" onClick={refresh} disabled={busy} aria-label={label} title={label}>
      <RefreshCw size={16} aria-hidden="true" className={busy ? 'spin' : undefined} />
    </button>
  );
}
