import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * CSRF defence-in-depth for cookie-authenticated endpoints (refresh/logout):
 * browsers always send Origin on cross-site POSTs, so a foreign Origin is refused.
 * Requests without Origin (non-browser clients, same-origin navigations) are allowed.
 */
export function requireTrustedOrigin(req, res, next) {
  const origin = req.get('Origin');
  if (origin && !env.clientUrls.includes(origin)) {
    return next(ApiError.forbidden('That is not allowed.'));
  }
  return next();
}
