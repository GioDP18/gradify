import axios from 'axios';
import { tokenStore } from './tokenStore';
import { trackRequests } from './loadingProgress';

/**
 * Same-origin by default: the browser calls /api on the frontend's own domain, which Vite (dev)
 * or Vercel (production rewrite) forwards to the backend. Keeping one origin is what lets the
 * HttpOnly, SameSite=Strict refresh cookie work. Override only for special setups.
 */
const baseURL = import.meta.env.VITE_API_URL || '/api';

/**
 * Error raised by every API call, carrying the backend's error envelope:
 * { success: false, error: { code, message, details, requestId } }
 */
export class ApiClientError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Used when a failed response carries no message of ours (a proxy or host error page, or a
 * failed file download): a short sentence for the user, never the status line or raw body.
 */
const STATUS_MESSAGES = {
  400: 'That request is not valid.',
  401: 'Please sign in again.',
  403: 'You do not have permission to do this.',
  404: 'Not found.',
  408: 'The server is taking too long. Try again.',
  409: 'That conflicts with a recent change. Reload and try again.',
  413: 'That file is too large.',
  429: 'Too many requests. Please wait and try again.',
  502: 'The server is unavailable. Try again shortly.',
  503: 'The server is unavailable. Try again shortly.',
  504: 'The server is taking too long. Try again.',
};

/** Every failure becomes an ApiClientError whose `message` is safe to show to the user. */
export function toApiClientError(error) {
  if (error instanceof ApiClientError) return error;
  if (error.response) {
    const { status, data } = error.response;
    const payload = data?.error ?? {};
    return new ApiClientError({
      status,
      code: payload.code ?? 'HTTP_ERROR',
      message: typeof payload.message === 'string' && payload.message ? payload.message : STATUS_MESSAGES[status] ?? GENERIC_MESSAGE,
      details: payload.details,
      requestId: payload.requestId,
    });
  }
  if (error.code === 'ECONNABORTED') {
    return new ApiClientError({ status: 0, code: 'TIMEOUT', message: 'The server is taking too long. Try again.' });
  }
  if (error.request || error.code === 'ERR_NETWORK') {
    return new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection.' });
  }
  // Not a network failure at all (a bug while preparing the request or reading the reply).
  return new ApiClientError({ status: 0, code: 'CLIENT_ERROR', message: GENERIC_MESSAGE });
}

const commonConfig = {
  baseURL,
  withCredentials: true, // sends the HttpOnly refresh-token cookie
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
};

/** Single, centrally configured HTTP client used by every API module. */
export const apiClient = axios.create(commonConfig);

/** Separate client for /auth/refresh so refreshing never re-enters the 401 interceptor. */
export const refreshClient = axios.create(commonConfig);

// Every request (and session refresh) drives the top progress bar.
trackRequests(apiClient);
trackRequests(refreshClient);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function performRefresh(attempt = 0) {
  try {
    const response = await refreshClient.post('/auth/refresh');
    const session = response.data.data;
    tokenStore.set(session.accessToken);
    return session;
  } catch (error) {
    const apiError = toApiClientError(error);
    // Another tab/request rotated the cookie a moment ago; the browser now holds the new one.
    if (apiError.code === 'REFRESH_RACE' && attempt < 2) {
      await delay(250);
      return performRefresh(attempt + 1);
    }
    throw apiError;
  }
}

let refreshInFlight = null;

/** Refreshes the session once, even if many requests ask at the same time. */
export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

apiClient.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const apiError = toApiClientError(error);
    const config = error.config;

    const canRetry = apiError.status === 401 && config && !config.skipAuthRefresh && !config._retried;
    if (!canRetry) return Promise.reject(apiError);

    try {
      await refreshSession();
    } catch {
      tokenStore.notifySessionExpired();
      return Promise.reject(apiError);
    }
    config._retried = true;
    config.headers.Authorization = `Bearer ${tokenStore.get()}`;
    return apiClient(config);
  },
);
