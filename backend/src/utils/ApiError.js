/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Anything thrown that is NOT an ApiError is treated as an unexpected 500.
 *
 * `message` is shown to users as-is: keep it short, plain, and free of internals (no library
 * error text, field paths, or tokens). Log the technical cause instead.
 */
export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'That could not be done. Reload the page and try again.', details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Please sign in.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have permission to do this.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Not found.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message = 'That already exists.', details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static validation(details, message = 'Some details are not valid. Check and try again.') {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }

  static tooManyRequests(message = 'Too many attempts. Please wait and try again.') {
    return new ApiError(429, 'TOO_MANY_REQUESTS', message);
  }

  static unavailable(message = 'Gradify is unavailable right now. Try again shortly.') {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message);
  }
}
