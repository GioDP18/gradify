/**
 * Consistent success envelope: { success: true, data, meta? }
 * Errors use { success: false, error: { code, message, details? } } (see errorHandler).
 */
export function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}
