/**
 * "Forgot password": a signed-out user asks for a reset link by email and chooses a new password.
 *
 * Security rules:
 *  - the answer to "send me a link" is the same whether or not an account uses that email, and
 *    takes about the same time, so it cannot be used to find out who has an account;
 *  - the link carries 256 random bits; only an HMAC of them is stored, the link works once, for
 *    RESET_MINUTES, and asking again cancels the earlier link;
 *  - at most MAX_REQUESTS_PER_HOUR links per account per hour (and a per-network limit in the
 *    route), so nobody can flood someone's inbox;
 *  - disabled accounts get no link;
 *  - the new password must meet the usual rules and differ from the current one;
 *  - a successful reset signs the account out everywhere, clears a login lock, is written to the
 *    audit log, and the owner is told by email that the password changed;
 *  - nobody is signed in by the link itself: the user signs in afterwards with the new password.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User, USER_STATUSES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../utils/password.js';
import { recordAudit } from './audit.service.js';
import { escapeHtml, isMailConfigured, sendMail } from './mail.service.js';

export const RESET_MINUTES = 30;
export const MAX_REQUESTS_PER_HOUR = 3;
// Every "send me a link" answer takes at least this long, so the time spent sending an email
// does not show which addresses have an account. (Not in tests.)
const MIN_RESPONSE_MS = env.isTest ? 0 : 2500;

const REQUEST_ANSWER = 'If an account uses that email address, a link to reset the password has been sent to it.';
const INVALID_LINK = 'This reset link is not valid or has expired. Request a new one.';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const newToken = () => crypto.randomBytes(32).toString('base64url'); // 43 characters, 256 bits
const hashToken = (token) => crypto.createHmac('sha256', env.jwt.refreshSecret).update(`password-reset:${token}`).digest('hex');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const invalidLink = () => new ApiError(400, 'RESET_LINK_INVALID', INVALID_LINK);

/** The app's address for the link: where the request came from, only if that is a known address. */
function clientOrigin(req) {
  const origin = req?.get?.('Origin');
  return origin && env.clientUrls.includes(origin) ? origin : env.clientUrls[0];
}

function frame(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f7f0e8;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#2b1d1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f0e8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#8a1218;border-bottom:4px solid #f0b738;padding:22px 28px;">
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#f6d488;">Gradify · EVSU</div>
<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:26px 28px 12px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
<tr><td style="padding:14px 28px 20px;border-top:1px solid #eadfd2;font-size:12px;color:#9a8b84;">Gradify · Eastern Visayas State University</td></tr>
</table></td></tr></table></body></html>`;
}

/** The email with the reset link. Exported for tests. */
export function buildResetEmail({ name, url }) {
  const text = [
    `Hello ${name},`,
    '',
    'We received a request to reset the password of your Gradify account.',
    '',
    `Choose a new password: ${url}`,
    '',
    `This link works once and only for ${RESET_MINUTES} minutes.`,
    'If you did not ask for this, you can ignore this email: your password stays the same. Do not forward this email or share the link.',
    '',
    'Gradify · Eastern Visayas State University',
  ].join('\n');
  const html = frame('Reset your password', `
<p style="margin:0 0 14px;">Hello ${escapeHtml(name)},</p>
<p style="margin:0 0 6px;">We received a request to reset the password of your Gradify account.</p>
<p style="margin:22px 0;text-align:center;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#8a1218;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:10px;">Choose a new password</a></p>
<p style="margin:0 0 10px;font-size:13px;color:#7a6a63;">This link works once and only for ${RESET_MINUTES} minutes.</p>
<p style="margin:0 0 10px;font-size:13px;color:#7a6a63;">If the button does not work, copy this address into your browser:<br><span style="color:#8a1218;word-break:break-all;">${escapeHtml(url)}</span></p>
<p style="margin:0 0 14px;font-size:13px;color:#7a6a63;">If you did not ask for this, you can ignore this email: your password stays the same. Do not forward this email or share the link.</p>`);
  return { subject: 'Reset your Gradify password', text, html };
}

function buildChangedEmail({ name }) {
  const text = [
    `Hello ${name},`,
    '',
    'The password of your Gradify account was just changed using a reset link, and the account was signed out on every device.',
    '',
    'If this was you, there is nothing more to do.',
    'If it was not you, someone may have access to your email. Reset your password again right away and tell your Gradify administrator.',
    '',
    'Gradify · Eastern Visayas State University',
  ].join('\n');
  const html = frame('Your password was changed', `
<p style="margin:0 0 14px;">Hello ${escapeHtml(name)},</p>
<p style="margin:0 0 14px;">The password of your Gradify account was just changed using a reset link, and the account was signed out on every device.</p>
<p style="margin:0 0 14px;">If this was you, there is nothing more to do.</p>
<p style="margin:0 0 14px;"><strong>If it was not you</strong>, someone may have access to your email. Reset your password again right away and tell your Gradify administrator.</p>`);
  return { subject: 'Your Gradify password was changed', text, html };
}

async function sendLinkIfAccount(email, req) {
  const user = await User.findOne({ email }).select('name email status').lean();
  if (!user || user.status !== USER_STATUSES.ACTIVE) return;

  const recent = await PasswordReset.countDocuments({ user: user._id, createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) } });
  if (recent >= MAX_REQUESTS_PER_HOUR) {
    await recordAudit({ userId: user._id, action: 'AUTH_PASSWORD_RESET_THROTTLED', collection: 'users', recordId: user._id, req });
    return;
  }

  // Earlier links stop working (they stay on record, used, so the hourly limit still counts them).
  await PasswordReset.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
  const token = newToken();
  await PasswordReset.create({
    user: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
    ip: req?.ip?.slice(0, 64),
    userAgent: req?.get?.('user-agent')?.slice(0, 300),
  });
  await recordAudit({ userId: user._id, action: 'AUTH_PASSWORD_RESET_REQUEST', collection: 'users', recordId: user._id, req });
  // The token travels in the address's fragment-free path once, to the account's own mailbox only.
  await sendMail({ to: user.email, ...buildResetEmail({ name: user.name, url: `${clientOrigin(req)}/reset-password/${token}` }) });
}

/** Step 1: ask for a link. Always the same answer, whatever the address. */
export async function requestPasswordReset(email, req) {
  if (!isMailConfigured()) {
    // Says nothing about any account: the feature is simply off on this server.
    throw ApiError.unavailable('Password reset by email is not available right now. Ask your Gradify administrator to set a new password for you.');
  }
  const normalized = String(email ?? '').trim().toLowerCase();
  const work = sendLinkIfAccount(normalized, req).catch((error) => {
    // Never shown to the requester: it would reveal that the address has an account.
    logger.error('Password reset request failed:', error.message);
  });
  await Promise.all([work, sleep(MIN_RESPONSE_MS)]);
  return { message: REQUEST_ANSWER };
}

async function findUsable(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const record = await PasswordReset.findOne({ tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } });
  if (!record) return null;
  const user = await User.findById(record.user).select('+passwordHash');
  if (!user || user.status !== USER_STATUSES.ACTIVE) return null;
  return { record, user };
}

/** Step 2 (page load): is this link still good? Reveals nothing else. */
export async function checkResetToken(token) {
  return { valid: Boolean(await findUsable(token)) };
}

/** Step 2: set the new password. */
export async function resetPassword(token, newPassword, req) {
  const found = await findUsable(token);
  if (!found) throw invalidLink();
  const { record, user } = found;

  // Checked before the link is used up, so a rejected password does not cost the user their link.
  const fieldError = (message) => ApiError.validation([{ field: 'newPassword', message }]);
  const problems = checkPasswordStrength(newPassword);
  if (problems.length) throw fieldError(`The new password needs ${problems.join(', ')}.`);
  if (await verifyPassword(newPassword, user.passwordHash)) throw fieldError('Choose a password different from your current one.');

  // Claim the link atomically: of two submissions at the same moment, only one goes through.
  const claimed = await PasswordReset.findOneAndUpdate(
    { _id: record._id, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!claimed) throw invalidLink();

  user.passwordHash = await hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // every access token issued before now stops working
  user.failedLoginCount = 0;
  user.lockUntil = undefined;
  await user.save();
  const revoked = await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' } });
  await PasswordReset.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
  await recordAudit({ userId: user._id, action: 'AUTH_PASSWORD_RESET', collection: 'users', recordId: user._id, metadata: { sessionsSignedOut: revoked.modifiedCount }, req });

  // Tell the owner. If this email cannot be sent the reset still stands (the cause is logged).
  await sendMail({ to: user.email, ...buildChangedEmail({ name: user.name }) }).catch(() => {});
  return { message: 'Your password has been changed. Sign in with your new password.' };
}
