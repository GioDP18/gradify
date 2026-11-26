import morgan from 'morgan';

/**
 * What a URL looks like in logs (privacy, I-2):
 *  - private link tokens are hidden, in API paths and in the web page's address (which browsers
 *    send as the Referer): QR self-enrollment (/api/public/enroll/<token>, /join/<token>), a
 *    student's shared grading sheet (/api/public/grades/<token>, /my-grades/<token>), and
 *    password reset links (/reset-password/<token>);
 *  - query strings are dropped, so student search terms and filters are never logged.
 */
export function redactUrl(url) {
  if (typeof url !== 'string' || url === '') return url;
  return url
    .split('?')[0]
    .split('#')[0]
    .replace(/(\/public\/(?:enroll|grades)\/)[^/]+/g, '$1[redacted]')
    .replace(/(\/(?:join|my-grades|reset-password)\/)[^/]+/g, '$1[redacted]');
}

// morgan's built-in formats read these tokens; both now go through redactUrl.
morgan.token('url', (req) => redactUrl(req.originalUrl || req.url));
morgan.token('referrer', (req) => redactUrl(req.headers.referer || req.headers.referrer));

/** HTTP access log with redacted URLs. `stream` is for tests; by default it writes to stdout. */
export function createRequestLogger({ format, stream } = {}) {
  return morgan(format, stream ? { stream } : undefined);
}
