import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../services/auth.service.js';
import { User, USER_STATUSES } from '../models/User.js';

/**
 * Verifies the Bearer access token, then re-reads the account from the database so that
 * disabled accounts and role changes take effect immediately (the token's role is never trusted alone).
 * The token's version (`tv`) must match the account's, so tokens issued before a logout, password
 * change, or admin reset are refused at once.
 */
export async function authenticate(req, res, next) {
  const header = req.get('Authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized());

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new ApiError(401, 'TOKEN_EXPIRED', 'Session expired. Please sign in again.'));
    }
    return next(ApiError.unauthorized('Session expired. Please sign in again.'));
  }

  const user = await User.findById(payload.sub).select('name email role status tokenVersion').lean();
  if (!user || user.status !== USER_STATUSES.ACTIVE) return next(ApiError.unauthorized('This account is not active.'));
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) return next(ApiError.unauthorized('Session expired. Please sign in again.'));

  req.user = { id: user._id.toString(), _id: user._id, name: user.name, email: user.email, role: user.role };
  return next();
}

/** Restricts a route to the given roles. Must run after authenticate. */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden(roles.length === 1 && roles[0] === 'ADMIN' ? 'Only the administrator can do this' : 'This area is restricted to instructors'));
    return next();
  };
}
