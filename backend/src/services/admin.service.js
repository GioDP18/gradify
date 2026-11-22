/**
 * Instructor account management for the administrator (D23). There is no public sign-up:
 * the administrator creates accounts, can disable/re-enable them, and can set a new password.
 */
import mongoose from 'mongoose';
import { User, ROLES, USER_STATUSES } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { Class } from '../models/Class.js';
import { ApiError } from '../utils/ApiError.js';
import { checkPasswordStrength, hashPassword } from '../utils/password.js';
import { recordAudit } from './audit.service.js';

const fieldError = (field, message) => ApiError.validation([{ field, message }]);
const MANAGED_ROLES = [ROLES.INSTRUCTOR, ROLES.ADMIN];

function checkPassword(password, field = 'password') {
  const problems = checkPasswordStrength(password);
  if (problems.length) throw fieldError(field, `The password needs ${problems.join(', ')}.`);
}

async function withClassCounts(users) {
  const counts = await Class.aggregate([
    { $match: { instructor: { $in: users.map((u) => u._id) }, status: 'ACTIVE' } },
    { $group: { _id: '$instructor', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
  return users.map((u) => ({ ...u.toPublic(), createdAt: u.createdAt, activeClasses: byId.get(u._id.toString()) ?? 0 }));
}

export async function listAccounts() {
  const users = await User.find({ role: { $in: MANAGED_ROLES } }).sort({ role: 1, name: 1 });
  return withClassCounts(users);
}

async function loadInstructor(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Account not found');
  const user = await User.findOne({ _id: id, role: ROLES.INSTRUCTOR });
  if (!user) throw ApiError.notFound('Account not found');
  return user;
}

export async function createInstructor(adminId, { name, email, username, password }, req) {
  checkPassword(password);
  if (await User.exists({ email })) throw fieldError('email', 'Another account already uses this email.');
  if (username && (await User.exists({ username }))) throw fieldError('username', 'This username is already taken.');
  const user = await User.create({ name, email, username: username || undefined, role: ROLES.INSTRUCTOR, passwordHash: await hashPassword(password) });
  await recordAudit({ userId: adminId, action: 'USER_CREATE', collection: 'users', recordId: user._id, newValue: user.toPublic(), req });
  return (await withClassCounts([user]))[0];
}

/** Disabling signs the instructor out everywhere; their classes and records are kept. */
export async function setStatus(adminId, id, status, req) {
  const user = await loadInstructor(id);
  if (user.status !== status) {
    user.status = status;
    if (status === USER_STATUSES.DISABLED) user.tokenVersion = (user.tokenVersion ?? 0) + 1; // end its access tokens too
    await user.save();
    if (status === USER_STATUSES.DISABLED) {
      await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DISABLED' } });
    }
    await recordAudit({ userId: adminId, action: status === USER_STATUSES.DISABLED ? 'USER_DISABLE' : 'USER_ENABLE', collection: 'users', recordId: user._id, req });
  }
  return (await withClassCounts([user]))[0];
}

/** Sets a new password (e.g. a forgotten one); unlocks the account and signs it out everywhere. */
export async function resetPassword(adminId, id, password, req) {
  checkPassword(password);
  const user = await loadInstructor(id);
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password), failedLoginCount: 0 }, $unset: { lockUntil: 1 }, $inc: { tokenVersion: 1 } });
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' } });
  await recordAudit({ userId: adminId, action: 'USER_PASSWORD_RESET', collection: 'users', recordId: user._id, req });
  return (await withClassCounts([user]))[0];
}
