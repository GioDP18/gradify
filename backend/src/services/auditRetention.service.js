/**
 * Audit-log retention (privacy, I-2). Run by the scheduled sweep. Three rules, each with its own
 * period in days (0 = keep forever):
 *
 *  1. AUDIT_IP_RETENTION_DAYS (default 90): the IP address and user agent are removed from
 *     older entries. The entry itself (who did what, when, to which record) stays.
 *  2. AUDIT_ROUTINE_RETENTION_DAYS (default 365): routine entries with no academic or security
 *     value (sign-ins, sign-outs, automatic recalculations, photo and preference changes) are deleted.
 *  3. AUDIT_RETENTION_DAYS (default 1825, five years): every remaining entry is deleted. This
 *     covers the academic trail: scores, attendance, enrollments, grading criteria, INC lapses,
 *     and security events such as lockouts and password changes.
 */
import { AuditLog } from '../models/AuditLog.js';
import { env } from '../config/env.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Entries deleted after the shorter "routine" period. Everything else is kept the full period. */
export const ROUTINE_ACTIONS = Object.freeze([
  'AUTH_LOGIN',
  'AUTH_LOGOUT',
  'AUTH_PREFERENCES_UPDATE',
  'AUTH_AVATAR_UPDATE',
  'AUTH_AVATAR_REMOVE',
  'GRADE_RECALCULATE',
  'GRADE_RECALCULATE_FAILED',
]);

const cutoff = (now, days) => new Date(now.getTime() - days * DAY_MS);

export async function applyAuditRetention({ now = new Date(), retention = env.auditRetention } = {}) {
  const result = { anonymized: 0, routineDeleted: 0, expiredDeleted: 0 };

  if (retention.ipDays > 0) {
    const res = await AuditLog.updateMany(
      { createdAt: { $lt: cutoff(now, retention.ipDays) }, $or: [{ 'metadata.ip': { $exists: true } }, { 'metadata.userAgent': { $exists: true } }] },
      { $unset: { 'metadata.ip': '', 'metadata.userAgent': '' } },
    );
    result.anonymized = res.modifiedCount;
  }
  if (retention.routineDays > 0) {
    const res = await AuditLog.deleteMany({ action: { $in: ROUTINE_ACTIONS }, createdAt: { $lt: cutoff(now, retention.routineDays) } });
    result.routineDeleted = res.deletedCount;
  }
  if (retention.allDays > 0) {
    const res = await AuditLog.deleteMany({ createdAt: { $lt: cutoff(now, retention.allDays) } });
    result.expiredDeleted = res.deletedCount;
  }
  return result;
}
