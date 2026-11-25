import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Reloads a page's list from the server (e.g. students who just enrolled by QR code).
 * `queryKeys`: the cached data to reload, e.g. [['students']].
 *
 * Returns `{ busy, refresh }`. Pass the result to <RefreshButton>, and show the list's loading
 * skeleton while `busy` is true: the old rows stay cached during a refetch, so without it a
 * slow connection would look as if nothing happened.
 */
export default function useRefresh(queryKeys) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await Promise.all(queryKeys.map((queryKey) => queryClient.refetchQueries({ queryKey, type: 'active' })));
    } finally {
      setBusy(false);
    }
  };

  return { busy, refresh };
}
