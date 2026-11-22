import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import { apiClient } from '../services/apiClient';
import { tokenStore } from '../services/tokenStore';
import * as authApi from '../services/authApi';

/** The real authApi against a fake network, to check exactly what is sent. */
describe('authApi', () => {
  let original;
  let sent;
  beforeEach(() => {
    original = apiClient.defaults.adapter;
    sent = [];
    tokenStore.set('access-1');
  });
  afterEach(() => {
    apiClient.defaults.adapter = original;
    tokenStore.clear();
  });
  const reply = (status, data) => (config) => {
    sent.push(config);
    const response = { data, status, statusText: String(status), headers: {}, config };
    return status >= 400 ? Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, response)) : Promise.resolve(response);
  };

  it('logs out without a request body (a JSON "null" body is refused by the server) and forgets the access token', async () => {
    apiClient.defaults.adapter = reply(204, '');
    await authApi.logout();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/auth/logout');
    expect(sent[0].data).toBeUndefined();
    expect(tokenStore.get()).toBeNull();
  });

  it('reports a failed logout and keeps the access token, because the session is still active', async () => {
    apiClient.defaults.adapter = reply(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    await expect(authApi.logout()).rejects.toMatchObject({ status: 500 });
    expect(tokenStore.get()).toBe('access-1');
  });

  it('continues with the new access token after a password change', async () => {
    apiClient.defaults.adapter = reply(200, { success: true, data: { otherSessionsSignedOut: 1, accessToken: 'access-2' } });
    const result = await authApi.changePassword({ currentPassword: 'a', newPassword: 'b' });
    expect(result.otherSessionsSignedOut).toBe(1);
    expect(tokenStore.get()).toBe('access-2');
  });
});
