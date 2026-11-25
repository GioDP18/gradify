import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { redactUrl } from './requestLogger.js';

/** What the user sees when something fails that is not their doing. The cause is logged, never sent. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export function notFound(req, res, next) {
  next(ApiError.notFound('Not found.'));
}

/**
 * Converts known library errors into ApiErrors with short messages a user can act on.
 * The library's own wording (schema paths, driver messages) is never sent to the client:
 * the error handler logs it.
 */
function normalize(error) {
  if (error instanceof ApiError) return error;

  if (error instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(Object.keys(error.errors).map((field) => ({ field, message: 'This value is not valid.' })));
  }
  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest('Some details are not valid. Check and try again.');
  }
  if (error?.code === 11000) {
    const fields = Object.keys(error.keyValue ?? error.keyPattern ?? {});
    return ApiError.conflict('That already exists.', { fields });
  }
  if (error?.type === 'entity.parse.failed') {
    return ApiError.badRequest('That could not be done. Reload the page and try again.');
  }
  if (error?.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That is too large to send.');
  }
  return null;
}

/**
 * The single place errors become responses. The client gets a stable code and a short message
 * written for users; raw messages and stack traces go to the server log only (find them by the
 * request ID, which is included in the response).
 */
// Express identifies error handlers by their 4-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  const known = normalize(error);
  const status = known?.statusCode ?? 500;
  const where = `[${req.id}] ${req.method} ${redactUrl(req.originalUrl)}:`;

  if (status >= 500) {
    logger.error(where, error?.stack || error);
  } else if (known !== error) {
    // A library error that was reworded for the user: keep its original text for whoever debugs it.
    logger.warn(where, error?.message ?? error);
  }

  const body = {
    success: false,
    error: {
      code: known?.code ?? 'INTERNAL_ERROR',
      message: known?.message ?? GENERIC_ERROR_MESSAGE,
    },
  };
  if (known?.details !== undefined) body.error.details = known.details;
  body.error.requestId = req.id;

  res.status(status).json(body);
}
