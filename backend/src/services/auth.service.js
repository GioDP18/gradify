import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User, USER_STATUSES } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyPassword, burnPasswordCheck, checkPasswordStrength, hashPassword } from '../utils/password.js';
import { recordAudit } from './audit.service.js';

// Account-wide lock. One client IP is stopped after 10 failures per account by loginLimiter, so
// reaching this needs failures from several networks: a single attacker can no longer lock a
// chosen instructor (or the administrator) out of their account.
export const MAX_FAILED_LOGINS = 50;
export const LOCK_MINUTES = 15;
// A rotated token presented again within this window is treated as a benign race
// (e.g. two browser tabs refreshing at once), not as theft.
export const ROTATION_GRACE_MS = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHmac('sha256', env.jwt.refreshSecret).update(token).digest('hex');
}

export function signAccessToken(user) {
  return jwt.sign({ role: user.role, tv: user.tokenVersion ?? 0 }, env.jwt.accessSecret, {
    subject: user._id.toString(),
    expiresIn: env.jwt.accessExpires,
    algorithm: 'HS256',
    issuer: 'evsu-grading-system',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, { algorithms: ['HS256'], issuer: 'evsu-grading-system' });
}

async function issueRefreshToken({ userId, family, remember, meta }) {
  const token = crypto.randomBytes(48).toString('base64url');
  const days = remember ? env.jwt.refreshRememberDays : env.jwt.refreshExpiresDays;
  const expiresAt = new Date(Date.now() + days * DAY_MS);
  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(token),
    family: family ?? crypto.randomUUID(),
    remember,
    expiresAt,
    userAgent: meta?.userAgent,
    ip: meta?.ip,
  });
  return { token, expiresAt, remember };
}

function buildSession(user, refresh) {
  return {
    user: user.toPublic(),
    accessToken: signAccessToken(user),
    accessTokenExpiresIn: env.jwt.accessExpires,
    refresh,
  };
}

/**
 * Verifies credentials and opens a session.
 * Error messages never reveal whether the identifier exists.
 */
export async function login({ identifier, password, remember = false }, req) {
  const normalized = identifier.trim().toLowerCase();
  const user = await User.findOne({ $or: [{ email: normalized }, { username: normalized }] }).select(
    '+passwordHash +failedLoginCount +lockUntil',
  );

  if (!user) {
    await burnPasswordCheck(password);
    throw ApiError.unauthorized('Invalid email/username or password');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  const locked = user.lockUntil && user.lockUntil > new Date();

  if (locked) {
    // Only someone who knows the password learns the account is locked; everyone else gets the
    // same generic answer as for an unknown account (no account enumeration).
    if (!valid) throw ApiError.unauthorized('Invalid email/username or password');
    const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new ApiError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute(s).`);
  }

  if (!valid) {
    // Atomic increment: parallel guesses cannot undercount failures.
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { returnDocument: 'after', projection: { failedLoginCount: 1 } },
    );
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      const lock = await User.updateOne(
        { _id: user._id, failedLoginCount: { $gte: MAX_FAILED_LOGINS } },
        { $set: { failedLoginCount: 0, lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } },
      );
      if (lock.modifiedCount) {
        await recordAudit({ userId: user._id, action: 'AUTH_ACCOUNT_LOCKED', collection: 'users', recordId: user._id, req });
      }
    }
    throw ApiError.unauthorized('Invalid email/username or password');
  }

  if (user.status !== USER_STATUSES.ACTIVE) {
    throw ApiError.forbidden('This account is disabled. Contact the system administrator.');
  }

  user.failedLoginCount = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const refresh = await issueRefreshToken({ userId: user._id, remember, meta: { ip: req?.ip, userAgent: req?.get?.('user-agent') } });
  await recordAudit({ userId: user._id, action: 'AUTH_LOGIN', collection: 'users', recordId: user._id, req });
  return buildSession(user, refresh);
}

/**
 * Exchanges a refresh token for a new access token and a rotated refresh token.
 */
export async function refreshSession(token, req) {
  if (!token) throw ApiError.unauthorized('Please sign in.');
  const tokenHash = hashToken(token);
  const now = new Date();

  // Atomically claim the token so it can be used exactly once.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, revokedReason: 'ROTATED' } },
    { returnDocument: 'before' },
  );

  if (!claimed) {
    const existing = await RefreshToken.findOne({ tokenHash });
    if (existing?.revokedReason === 'ROTATED') {
      if (now - existing.revokedAt <= ROTATION_GRACE_MS) {
        throw new ApiError(401, 'REFRESH_RACE', 'Please try again.');
      }
      // A rotated token was replayed later: assume theft and end every session in the family.
      await RefreshToken.updateMany(
        { family: existing.family, revokedAt: null },
        { $set: { revokedAt: now, revokedReason: 'REUSE_DETECTED' } },
      );
      await recordAudit({ userId: existing.user, action: 'AUTH_REFRESH_REUSE', collection: 'refreshTokens', recordId: existing._id, req });
    }
    throw ApiError.unauthorized('Session expired. Please sign in again.');
  }

  const user = await User.findById(claimed.user);
  if (!user || user.status !== USER_STATUSES.ACTIVE) {
    await RefreshToken.updateMany({ user: claimed.user, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'ACCOUNT_DISABLED' } });
    throw ApiError.unauthorized('Session expired. Please sign in again.');
  }

  const refresh = await issueRefreshToken({
    userId: user._id,
    family: claimed.family,
    remember: claimed.remember,
    meta: { ip: req?.ip, userAgent: req?.get?.('user-agent') },
  });
  await RefreshToken.updateOne({ _id: claimed._id }, { $set: { replacedByHash: hashToken(refresh.token) } });
  return buildSession(user, refresh);
}

export async function logout(token, req) {
  if (!token) return;
  const revoked = await RefreshToken.findOneAndUpdate(
    { tokenHash: hashToken(token), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'LOGOUT' } },
  );
  if (revoked) {
    // Access tokens issued so far stop working now, not when they expire. Other devices keep
    // their own refresh cookies and get a new access token on their next request.
    await User.updateOne({ _id: revoked.user }, { $inc: { tokenVersion: 1 } });
    await recordAudit({ userId: revoked.user, action: 'AUTH_LOGOUT', collection: 'users', recordId: revoked.user, req });
  }
}

export async function getCurrentUser(userId) {
  const user = await User.findById(userId);
  if (!user || user.status !== USER_STATUSES.ACTIVE) throw ApiError.unauthorized('Session expired. Please sign in again.');
  return user.toPublic();
}

/* ───────── Own profile ───────── */

const fieldError = (field, message) => ApiError.validation([{ field, message }]);

async function loadWithPassword(userId) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || user.status !== USER_STATUSES.ACTIVE) throw ApiError.unauthorized('Session expired. Please sign in again.');
  return user;
}

/**
 * Updates the signed-in user's name, email, and username. Email and username are what the user
 * signs in with, so changing either requires the current password.
 */
export async function updateProfile(userId, { name, email, username, currentPassword }, req) {
  const user = await loadWithPassword(userId);
  const next = {
    name: name ?? user.name,
    email: email ?? user.email,
    // An empty username removes it (sign in with email only).
    username: username === undefined ? user.username ?? null : username || null,
  };
  const signInChanged = next.email !== user.email || next.username !== (user.username ?? null);

  if (signInChanged) {
    if (!currentPassword) throw fieldError('currentPassword', 'Enter your current password to change your email or username.');
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw fieldError('currentPassword', 'Current password is incorrect.');
  }
  if (next.email !== user.email && (await User.exists({ email: next.email, _id: { $ne: user._id } }))) {
    throw fieldError('email', 'Another account already uses this email.');
  }
  if (next.username && next.username !== user.username && (await User.exists({ username: next.username, _id: { $ne: user._id } }))) {
    throw fieldError('username', 'This username is already taken.');
  }

  const previous = { name: user.name, email: user.email, username: user.username ?? null };
  user.name = next.name;
  user.email = next.email;
  user.username = next.username ?? undefined;
  await user.save();
  await recordAudit({ userId: user._id, action: 'AUTH_PROFILE_UPDATE', collection: 'users', recordId: user._id, previousValue: previous, newValue: next, req });
  return user.toPublic();
}

/**
 * Changes the signed-in user's password. Every other session (other browsers and devices) is
 * signed out; the session making the change stays signed in.
 */
export async function changePassword(userId, { currentPassword, newPassword }, currentRefreshToken, req) {
  const user = await loadWithPassword(userId);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw fieldError('currentPassword', 'Current password is incorrect.');
  const problems = checkPasswordStrength(newPassword);
  if (problems.length) throw fieldError('newPassword', `The new password needs ${problems.join(', ')}.`);
  if (await verifyPassword(newPassword, user.passwordHash)) throw fieldError('newPassword', 'Choose a password different from your current one.');

  user.passwordHash = await hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // every access token issued before now stops working
  await user.save();
  const keep = currentRefreshToken ? hashToken(currentRefreshToken) : null;
  const revoked = await RefreshToken.updateMany(
    { user: user._id, revokedAt: null, ...(keep ? { tokenHash: { $ne: keep } } : {}) },
    { $set: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' } },
  );
  await recordAudit({ userId: user._id, action: 'AUTH_PASSWORD_CHANGE', collection: 'users', recordId: user._id, metadata: { otherSessionsSignedOut: revoked.modifiedCount }, req });
  // The session that made the change continues with a fresh access token.
  return { otherSessionsSignedOut: revoked.modifiedCount, accessToken: signAccessToken(user), accessTokenExpiresIn: env.jwt.accessExpires };
}

/* ───────── Profile photo ───────── */

/**
 * Identifies the image from its first bytes (never from the file name or the browser's claim).
 * Only JPEG, PNG, and WebP are accepted — SVG is refused because it can carry scripts.
 */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function setAvatar(userId, file, req) {
  const contentType = detectImageType(file?.buffer);
  if (!contentType) throw ApiError.badRequest('Use a JPEG, PNG, or WebP image.');
  const user = await User.findById(userId);
  if (!user || user.status !== USER_STATUSES.ACTIVE) throw ApiError.unauthorized('Session expired. Please sign in again.');
  user.avatar = { data: file.buffer, contentType };
  user.avatarUpdatedAt = new Date();
  await user.save();
  await recordAudit({ userId: user._id, action: 'AUTH_AVATAR_UPDATE', collection: 'users', recordId: user._id, metadata: { contentType, bytes: file.buffer.length }, req });
  return user.toPublic();
}

export async function removeAvatar(userId, req) {
  const user = await User.findById(userId);
  if (!user || user.status !== USER_STATUSES.ACTIVE) throw ApiError.unauthorized('Session expired. Please sign in again.');
  if (user.avatarUpdatedAt) {
    user.avatar = undefined;
    user.avatarUpdatedAt = undefined;
    await user.save();
    await recordAudit({ userId: user._id, action: 'AUTH_AVATAR_REMOVE', collection: 'users', recordId: user._id, req });
  }
  return user.toPublic();
}

export async function getAvatar(userId) {
  const user = await User.findById(userId).select('+avatar');
  if (!user?.avatar?.data) throw ApiError.notFound('No profile photo');
  return user.avatar;
}

/* ───────── Personal settings ───────── */

export async function updatePreferences(userId, changes, req) {
  const user = await User.findById(userId);
  if (!user || user.status !== USER_STATUSES.ACTIVE) throw ApiError.unauthorized('Session expired. Please sign in again.');
  const previous = { workingClass: user.preferences?.workingClass ?? true, chatHistory: user.preferences?.chatHistory ?? true };
  if (changes.workingClass !== undefined) user.set('preferences.workingClass', changes.workingClass);
  if (changes.chatHistory !== undefined) user.set('preferences.chatHistory', changes.chatHistory);
  await user.save();
  await recordAudit({ userId: user._id, action: 'AUTH_PREFERENCES_UPDATE', collection: 'users', recordId: user._id, previousValue: previous, newValue: changes, req });
  return user.toPublic();
}
