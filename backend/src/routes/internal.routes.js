import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { sweep } from '../services/grading/grading.service.js';
import { applyAuditRetention } from '../services/auditRetention.service.js';

/**
 * Scheduled maintenance, called by Vercel Cron (GET with "Authorization: Bearer <CRON_SECRET>").
 * Disabled (404) unless CRON_SECRET is configured. Not reachable with user tokens.
 */
const router = Router();

function requireCronSecret(req, res, next) {
  if (!env.cronSecret) return next(ApiError.notFound());
  const given = Buffer.from(req.get('Authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.cronSecret}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return next(ApiError.unauthorized());
  return next();
}

// Retries stale/failed grade recalculations and applies INC lapses (Handbook §55.1).
// Then applies audit-log retention (removes old IP addresses, deletes expired entries).
router.get('/sweep', requireCronSecret, async (req, res) => {
  const grades = await sweep();
  return sendSuccess(res, { ...grades, audit: await applyAuditRetention() });
});

export default router;
