import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import { apiClient, refreshClient, toApiClientError, ApiClientError } from '../services/apiClient';
import { tokenStore } from '../services/tokenStore';

function respond(config, status, data) {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) {
    return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, response));
  }
  return Promise.resolve(response);
}

describe('toApiClientError', () => {
  it('maps the backend error envelope', () => {
    const error = toApiClientError({
      response: {
        status: 422,
        data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field: 'score' }], requestId: 'abc12345' } },
      },
    });
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'Validation failed', requestId: 'abc12345' });
  });

  it('maps network failures, timeouts, and non-envelope responses', () => {
    expect(toApiClientError({ code: 'ERR_NETWORK' })).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(toApiClientError({ code: 'ECONNABORTED' })).toMatchObject({ status: 0, code: 'TIMEOUT' });
    expect(toApiClientError({ response: { status: 502, data: '<html>' } })).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('never shows a status line, raw body, or exception text to the user', () => {
    expect(toApiClientError({ response: { status: 502, data: '<html>Bad Gateway</html>' } }).message).toBe('Gradify is unavailable right now. Try again shortly.');
    expect(toApiClientError({ response: { status: 500, data: new Blob(['{}']) } }).message).toBe('Something went wrong. Please try again.'); // a failed file download
    expect(toApiClientError({ response: { status: 418, data: { error: { message: { nested: true } } } } }).message).toBe('Something went wrong. Please try again.');
    expect(toApiClientError({ code: 'ERR_NETWORK', message: 'Network Error' }).message).toBe('No connection. Check your internet and try again.');
    expect(toApiClientError(new TypeError("Cannot read properties of undefined (reading 'data')"))).toMatchObject({ code: 'CLIENT_ERROR', message: 'Something went wrong. Please try again.' });
  });
});

describe('automatic session refresh', () => {
  let originalApiAdapter;
  let originalRefreshAdapter;

  beforeEach(() => {
    originalApiAdapter = apiClient.defaults.adapter;
    originalRefreshAdapter = refreshClient.defaults.adapter;
    tokenStore.set('expired-token');
  });

  afterEach(() => {
    apiClient.defaults.adapter = originalApiAdapter;
    refreshClient.defaults.adapter = originalRefreshAdapter;
    tokenStore.clear();
  });

  it('refreshes once on 401 and retries the request with the new token', async () => {
    const seenTokens = [];
    apiClient.defaults.adapter = (config) => {
      seenTokens.push(config.headers.Authorization);
      return config.headers.Authorization === 'Bearer fresh-token'
        ? respond(config, 200, { success: true, data: 'ok' })
        : respond(config, 401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' } });
    };
    const refresh = vi.fn((config) => respond(config, 200, { success: true, data: { accessToken: 'fresh-token', user: {} } }));
    refreshClient.defaults.adapter = refresh;

    const [a, b] = await Promise.all([apiClient.get('/classes'), apiClient.get('/students')]);
    expect(a.data.data).toBe('ok');
    expect(b.data.data).toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1); // concurrent 401s share one refresh
    expect(seenTokens.filter((t) => t === 'Bearer expired-token')).toHaveLength(2);
    expect(tokenStore.get()).toBe('fresh-token');
  });

  it('signals session expiry when the refresh fails', async () => {
    apiClient.defaults.adapter = (config) => respond(config, 401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    refreshClient.defaults.adapter = (config) => respond(config, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
    const onExpired = vi.fn();
    const unsubscribe = tokenStore.onSessionExpired(onExpired);

    await expect(apiClient.get('/classes')).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBeNull();
    unsubscribe();
  });

  it('retries the refresh after a benign concurrent-rotation race', async () => {
    let refreshCalls = 0;
    apiClient.defaults.adapter = (config) =>
      config.headers.Authorization === 'Bearer fresh-token'
        ? respond(config, 200, { success: true, data: 'ok' })
        : respond(config, 401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    refreshClient.defaults.adapter = (config) => {
      refreshCalls += 1;
      return refreshCalls === 1
        ? respond(config, 401, { success: false, error: { code: 'REFRESH_RACE', message: 'retry' } })
        : respond(config, 200, { success: true, data: { accessToken: 'fresh-token' } });
    };
    const res = await apiClient.get('/classes');
    expect(res.data.data).toBe('ok');
    expect(refreshCalls).toBe(2);
  });

  it('does not try to refresh for requests that opt out (e.g. login)', async () => {
    apiClient.defaults.adapter = (config) => respond(config, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid email/username or password' } });
    const refresh = vi.fn();
    refreshClient.defaults.adapter = refresh;
    await expect(apiClient.post('/auth/login', {}, { skipAuthRefresh: true })).rejects.toMatchObject({
      message: 'Invalid email/username or password',
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
