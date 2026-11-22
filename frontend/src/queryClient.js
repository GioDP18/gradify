import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Retry transient failures once; never retry client errors (4xx).
        retry: (failureCount, error) => failureCount < 1 && !(error?.status >= 400 && error?.status < 500),
      },
      mutations: { retry: false },
    },
  });
}
