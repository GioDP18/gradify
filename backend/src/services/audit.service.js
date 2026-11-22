import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

const SENSITIVE_KEYS = /pass(word)?|hash|token|secret|cookie|authorization/i;

/** Deep-copies a value for logging, dropping any key that could hold credentials. */
export function redact(value, depth = 0) {
  if (value === null || value === undefined || depth > 8) return value;
  if (typeof value?.toObject === 'function') return redact(value.toObject({ depopulate: true }), depth);
  if (value instanceof Date || typeof value !== 'object') return value;
  if (value?._bsontype === 'ObjectId') return value.toString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    out[key] = redact(child, depth + 1);
  }
  return out;
}

export function requestMeta(req) {
  return req ? { ip: req.ip, userAgent: req.get?.('user-agent')?.slice(0, 300), requestId: req.id } : undefined;
}

/**
 * Writes an audit entry. Pass `session` to include it in a transaction.
 * Audit failures outside a transaction are logged but never break the user's request.
 */
export async function recordAudit(
  { userId, action, collection, recordId, classId, previousValue, newValue, metadata, req },
  { session } = {},
) {
  const entry = {
    user: userId,
    action,
    affectedCollection: collection,
    recordId,
    class: classId,
    previousValue: redact(previousValue),
    newValue: redact(newValue),
    metadata: { ...requestMeta(req), ...redact(metadata) },
  };
  if (session) {
    await AuditLog.create([entry], { session });
    return;
  }
  try {
    await AuditLog.create(entry);
  } catch (error) {
    logger.error(`Audit log write failed for ${action}:`, error.message);
  }
}
