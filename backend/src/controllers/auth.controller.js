import { env } from '../config/env.js';
import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';

export const REFRESH_COOKIE = 'evsu_rt';
const COOKIE_PATH = '/api/auth';

function setRefreshCookie(res, refresh) {
  res.cookie(REFRESH_COOKIE, refresh.token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    // "Remember me" → persistent cookie; otherwise a session cookie that ends with the browser.
    ...(refresh.remember ? { expires: refresh.expiresAt } : {}),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: COOKIE_PATH });
}

function sessionBody(session) {
  return { user: session.user, accessToken: session.accessToken, accessTokenExpiresIn: session.accessTokenExpiresIn };
}

export async function login(req, res) {
  const session = await authService.login(req.body, req);
  setRefreshCookie(res, session.refresh);
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, sessionBody(session));
}

export async function refresh(req, res) {
  try {
    const session = await authService.refreshSession(req.cookies?.[REFRESH_COOKIE], req);
    setRefreshCookie(res, session.refresh);
    res.set('Cache-Control', 'no-store');
    return sendSuccess(res, sessionBody(session));
  } catch (error) {
    // Keep the cookie during a benign concurrent-refresh race; the browser already holds the new one.
    if (error.code !== 'REFRESH_RACE') clearRefreshCookie(res);
    throw error;
  }
}

export async function logout(req, res) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE], req);
  clearRefreshCookie(res);
  return res.status(204).end();
}

export async function me(req, res) {
  const user = await authService.getCurrentUser(req.user.id);
  return sendSuccess(res, { user });
}

export async function updateProfile(req, res) {
  const user = await authService.updateProfile(req.user.id, req.body, req);
  return sendSuccess(res, { user });
}

export async function changePassword(req, res) {
  const result = await authService.changePassword(req.user.id, req.body, req.cookies?.[REFRESH_COOKIE], req);
  res.set('Cache-Control', 'no-store'); // the response carries a new access token
  return sendSuccess(res, result);
}

export async function getAvatar(req, res) {
  const avatar = await authService.getAvatar(req.user.id);
  // Private to this user. Clients add ?v=<avatarUpdatedAt>, so a changed photo is a new URL.
  res.set({ 'Content-Type': avatar.contentType, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'inline' });
  return res.send(avatar.data);
}

export async function setAvatar(req, res) {
  const user = await authService.setAvatar(req.user.id, req.file, req);
  return sendSuccess(res, { user });
}

export async function removeAvatar(req, res) {
  const user = await authService.removeAvatar(req.user.id, req);
  return sendSuccess(res, { user });
}

export async function updatePreferences(req, res) {
  const user = await authService.updatePreferences(req.user.id, req.body, req);
  return sendSuccess(res, { user });
}
