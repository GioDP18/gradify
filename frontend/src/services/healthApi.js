import { apiClient } from './apiClient';

/** GET /api/health — 503 is a valid "degraded" answer, not a transport failure. */
export async function fetchHealth() {
  const response = await apiClient.get('/health', {
    validateStatus: (status) => status === 200 || status === 503,
  });
  return response.data.data;
}
