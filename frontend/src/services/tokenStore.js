/**
 * Holds the short-lived access token in memory only (never localStorage),
 * so it cannot be read by injected scripts after a page reload. The long-lived
 * refresh token lives in an HttpOnly cookie the frontend cannot read at all.
 */
let accessToken = null;
const expiryListeners = new Set();

export const tokenStore = {
  get: () => accessToken,
  set: (token) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
  /** Called when the session can no longer be refreshed (e.g. cookie expired or revoked). */
  onSessionExpired(listener) {
    expiryListeners.add(listener);
    return () => expiryListeners.delete(listener);
  },
  notifySessionExpired() {
    accessToken = null;
    expiryListeners.forEach((listener) => listener());
  },
};
