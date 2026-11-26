/**
 * First-run setup of a database: collections, indexes and the first administrator account.
 *
 * Runs when the API starts (and on each serverless cold start) only if SEED_DATABASE=true, and
 * does something only while the database is empty (it has no user accounts). Once an account
 * exists it is a single cheap count, so the setting can stay on. Nothing is ever overwritten.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { User, ROLES } from '../models/User.js';
import '../models/RefreshToken.js';
import '../models/PasswordReset.js';
import '../models/AssistantChat.js';
import '../models/AuditLog.js';
import '../models/Class.js';
import '../models/Student.js';
import '../models/Enrollment.js';
import '../models/AttendanceSession.js';
import '../models/AttendanceRecord.js';
import '../models/assessments.js';
import '../models/GradingConfiguration.js';
import '../models/ComputedGrade.js';
import '../models/RateLimitHit.js';
import { checkPasswordStrength, hashPassword, PASSWORD_RULES } from '../utils/password.js';
import { recordAudit } from './audit.service.js';

/**
 * Creates every collection and index the application needs. Idempotent: existing collections
 * and indexes are left alone. `onModel(model, indexes)` is called after each one (for reporting).
 */
export async function createCollectionsAndIndexes(onModel) {
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch((error) => {
      if (error?.codeName !== 'NamespaceExists') throw error;
    });
    await model.createIndexes();
    if (onModel) onModel(model, await model.collection.indexes());
  }
}

/** A database is empty until it has its first account. */
export async function isDatabaseEmpty() {
  return (await User.estimatedDocumentCount()) === 0;
}

/**
 * Seeds the database if seeding is switched on and the database is empty.
 * Returns { seeded, reason? }; reason is 'disabled' or 'not-empty' when nothing was done.
 */
export async function seedDatabaseIfEmpty(seed = env.seed) {
  if (!seed?.enabled) return { seeded: false, reason: 'disabled' };
  if (!(await isDatabaseEmpty())) return { seeded: false, reason: 'not-empty' };

  const { name, email, username, password } = seed.admin;
  const problems = checkPasswordStrength(password);
  if (problems.length) throw new Error(`SEED_ADMIN_PASSWORD must have ${PASSWORD_RULES}.`);

  // Indexes first: the unique email index is what stops two instances that start at the same
  // moment from both creating the administrator.
  await createCollectionsAndIndexes();

  let admin;
  try {
    admin = await User.create({ name, email, username: username || undefined, role: ROLES.ADMIN, passwordHash: await hashPassword(password) });
  } catch (error) {
    if (error?.code === 11000) return { seeded: false, reason: 'not-empty' }; // another instance got there first
    throw error;
  }
  await recordAudit({ userId: admin._id, action: 'USER_CREATE_SEED', collection: 'users', recordId: admin._id, newValue: admin.toPublic() });
  logger.info(`Database seeded: collections, indexes, and the administrator account for ${email}.`);
  return { seeded: true };
}

let attempt = null;

/**
 * Seeds at most once per process and never throws: a failed seed is logged and the API keeps
 * serving (the next start tries again). Safe to await before every request.
 */
export function seedOnStartup() {
  if (!env.seed.enabled) return Promise.resolve();
  if (!attempt) {
    attempt = seedDatabaseIfEmpty().catch((error) => {
      logger.error('Database seeding failed:', error.message);
    });
  }
  return attempt;
}
