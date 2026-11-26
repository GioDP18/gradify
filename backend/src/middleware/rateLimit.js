import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { MongoRateLimitStore } from './mongoRateLimitStore.js';

const WINDOW_MS = 15 * 60 * 1000;
const tooManyLogins = (req, res, next) => next(ApiError.tooManyRequests('Too many login attempts. Please wait 15 minutes and try again.'));

/**
 * General API limiter (per IP, per instance). Best-effort burst protection: on serverless hosts
 * each instance counts separately. Login limits below are shared through MongoDB.
 */
export const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (req, res, next) => next(ApiError.tooManyRequests()),
});

/**
 * Login brute-force protection, counted in MongoDB so it holds across all serverless instances.
 * Only failed attempts count. If the store is unreachable the request is allowed (passOnStoreError);
 * the per-account lockout in the users collection still applies.
 *
 * Per client IP + account: one network's failures against an account never block that account's
 * owner signing in from another network. If the platform reports a proxy address instead of real
 * client IPs, this simply behaves as a per-account limit.
 */
export const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new MongoRateLimitStore({ prefix: 'login-account' }),
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.identifier ?? '').trim().toLowerCase().slice(0, 254) || '(empty)'}`,
  handler: tooManyLogins,
});

/** Per client IP (password spraying across accounts). LOGIN_IP_RATE_LIMIT=0 disables it. */
export const loginIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: env.loginIpRateLimit || 1,
  skip: () => env.loginIpRateLimit === 0,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new MongoRateLimitStore({ prefix: 'login-ip' }),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: tooManyLogins,
});

/**
 * QR self-enrollment (no sign-in): per client IP per class link, SELF_ENROLL_IP_LIMIT submissions
 * per 15 minutes (default 150; 0 disables it). A whole class usually shares one campus IP, so the
 * limit is sized for a classroom, and keying on the link keeps one class's traffic (or abuse of
 * its QR code) from blocking other classes. The instructor's on/off switch and "New link" remain
 * the main abuse controls.
 */
export const selfEnrollLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: env.selfEnrollIpLimit || 1,
  skip: () => env.selfEnrollIpLimit === 0,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new MongoRateLimitStore({ prefix: 'self-enroll' }),
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${req.params.token}`,
  handler: (req, res, next) => next(ApiError.tooManyRequests('Too many enrollment attempts for this class from your network. Please wait 15 minutes and try again.')),
});

/**
 * "Forgot password" (no sign-in), per client IP, counted in MongoDB so it holds across all
 * serverless instances. Asking for a link: 5 per 15 minutes (each account is also limited per
 * hour in the service). Opening or submitting a link: 20 per 15 minutes.
 */
const resetLimiter = (prefix, limit, message) => rateLimit({
  windowMs: WINDOW_MS,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new MongoRateLimitStore({ prefix }),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: (req, res, next) => next(ApiError.tooManyRequests(message)),
});
export const passwordResetRequestLimiter = resetLimiter('password-reset-request', 5, 'Too many reset requests. Please wait 15 minutes and try again.');
export const passwordResetSubmitLimiter = resetLimiter('password-reset-submit', 20, 'Too many attempts. Please wait 15 minutes and try again.');

/** Emails sent to students (grading sheet links), per signed-in instructor: 60 per 15 minutes. */
export const studentEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 60,
  skip: () => env.isTest,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new MongoRateLimitStore({ prefix: 'student-email' }),
  keyGenerator: (req) => String(req.user?.id ?? '(anonymous)'),
  handler: (req, res, next) => next(ApiError.tooManyRequests('Too many emails sent in a short time. Please wait 15 minutes and try again.')),
});

/**
 * Re-entering the current password on the profile page (per signed-in user). Only failed
 * attempts count, so a stolen access token cannot be used to guess the password.
 */
export const passwordCheckLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new MongoRateLimitStore({ prefix: 'password-check' }),
  keyGenerator: (req) => String(req.user?.id ?? '(anonymous)'),
  handler: (req, res, next) => next(ApiError.tooManyRequests('Too many incorrect password attempts. Please wait 15 minutes and try again.')),
});
