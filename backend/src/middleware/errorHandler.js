import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { redactUrl } from './requestLogger.js';

export function notFound(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl.split('?')[0]} not found`));
}

/** Converts known library errors into ApiErrors with safe, consistent messages. */
function normalize(error) {
  if (error instanceof ApiError) return error;

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.validation(details);
  }
  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for ${error.path}`);
  }
  if (error?.code === 11000) {
    const fields = Object.keys(error.keyValue ?? error.keyPattern ?? {});
    return ApiError.conflict('A record with the same unique value already exists', { fields });
  }
  if (error?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON in request body');
  }
  if (error?.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  return null;
}

/**
 * Builds the error handler. `exposeStacks` adds the stack trace of unexpected errors to the
 * response; it is on only in local development (never on a hosted deployment).
 */
export function createErrorHandler({ exposeStacks = false } = {}) {
  // Express identifies error handlers by their 4-argument signature.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(error, req, res, next) {
    const known = normalize(error);
    const status = known?.statusCode ?? 500;

    if (status >= 500) {
      logger.error(`[${req.id}] ${req.method} ${redactUrl(req.originalUrl)}:`, error?.stack || error);
    }

    const body = {
      success: false,
      error: {
        code: known?.code ?? 'INTERNAL_ERROR',
        message: known?.message ?? 'An unexpected error occurred',
      },
    };
    if (known?.details !== undefined) body.error.details = known.details;
    if (!known && exposeStacks) body.error.stack = error?.stack;
    body.error.requestId = req.id;

    res.status(status).json(body);
  };
}

export const errorHandler = createErrorHandler({ exposeStacks: env.exposeErrorStacks });
