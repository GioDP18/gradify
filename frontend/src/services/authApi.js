import { apiClient, refreshSession } from './apiClient';
import { tokenStore } from './tokenStore';

export async function login({ identifier, password, remember }) {
  const response = await apiClient.post(
    '/auth/login',
    { identifier, password, remember: Boolean(remember) },
    { skipAuthRefresh: true },
  );
  const session = response.data.data;
  tokenStore.set(session.accessToken);
  return session.user;
}

/** Restores a session from the HttpOnly refresh cookie (used on page load). */
export async function restoreSession() {
  const session = await refreshSession();
  return session.user;
}

/**
 * Ends the session on the server (revokes the refresh cookie). Sent without a body: a JSON body
 * of `null` is refused by the server's parser, which used to leave the session alive.
 * Throws if the server could not be reached; the session is then still active.
 */
export async function logout() {
  await apiClient.post('/auth/logout', undefined, { skipAuthRefresh: true });
  tokenStore.clear();
}

/** Forgot password, step 1: ask for a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(email) {
  const response = await apiClient.post('/auth/password/forgot', { email }, { skipAuthRefresh: true, timeout: 45000 });
  return response.data.data;
}

/** Forgot password, step 2: is the emailed link still good? */
export async function checkResetToken(token) {
  const response = await apiClient.post('/auth/password/reset/check', { token }, { skipAuthRefresh: true });
  return response.data.data.valid;
}

/** Forgot password, step 2: set the new password with the emailed link. */
export async function resetPassword(token, newPassword) {
  const response = await apiClient.post('/auth/password/reset', { token, newPassword }, { skipAuthRefresh: true, timeout: 45000 });
  return response.data.data;
}

export async function fetchCurrentUser() {
  const response = await apiClient.get('/auth/me');
  return response.data.data.user;
}

/** Updates the signed-in user's own name, email, and username. */
export async function updateProfile(changes) {
  const response = await apiClient.patch('/auth/me', changes);
  return response.data.data.user;
}

/** Changes the signed-in user's password (other devices are signed out). */
export async function changePassword({ currentPassword, newPassword }) {
  const response = await apiClient.put('/auth/me/password', { currentPassword, newPassword });
  // Earlier access tokens stop working on a password change; continue with the new one.
  if (response.data.data.accessToken) tokenStore.set(response.data.data.accessToken);
  return response.data.data;
}

/** Uploads a profile photo (an already-resized image Blob). Returns the updated user. */
export async function uploadAvatar(blob) {
  const form = new FormData();
  form.append('avatar', blob, blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg');
  const response = await apiClient.put('/auth/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return response.data.data.user;
}

export async function removeAvatar() {
  const response = await apiClient.delete('/auth/me/avatar');
  return response.data.data.user;
}

/** The photo as a Blob; `version` (avatarUpdatedAt) makes each new photo a new URL. */
export async function fetchAvatar(version) {
  const response = await apiClient.get('/auth/me/avatar', { params: { v: version }, responseType: 'blob' });
  return response.data;
}

/** Saves personal settings, e.g. { workingClass: false }. Returns the updated user. */
export async function updatePreferences(changes) {
  const response = await apiClient.patch('/auth/me/preferences', changes);
  return response.data.data.user;
}
