import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

export const PASSWORD_RULES = 'at least 12 characters, with upper- and lowercase letters, a number, and a symbol';

/**
 * bcrypt ignores everything after the first 72 bytes, so a longer password would be only as
 * strong as its first 72 bytes. Passwords are capped there, measured in bytes: accented letters
 * and emoji take more than one byte each.
 */
export const MAX_PASSWORD_BYTES = 72;
export const passwordFitsBcrypt = (password) => Buffer.byteLength(String(password ?? ''), 'utf8') <= MAX_PASSWORD_BYTES;
export const PASSWORD_TOO_LONG = 'Password is too long. Use 72 characters or fewer.';

/** Returns a list of unmet password requirements (empty = acceptable). */
export function checkPasswordStrength(password = '') {
  const problems = [];
  if (password.length < 12) problems.push('at least 12 characters');
  if (!passwordFitsBcrypt(password)) problems.push('72 characters or fewer');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/\d/.test(password)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
  return problems;
}

export function hashPassword(password) {
  return bcrypt.hash(password, env.bcryptRounds);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Used when no account matches, so response time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', env.bcryptRounds);
export function burnPasswordCheck(password) {
  return bcrypt.compare(password, DUMMY_HASH);
}
