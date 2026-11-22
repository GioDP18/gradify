import morgan from 'morgan';

/**
 * What a URL looks like in logs (privacy, I-2):
 *  - the QR self-enrollment token is hidden, in API paths (/api/public/enroll/<token>) and in
 *    the web page's address (/join/<token>, which browsers send as the Referer);
 *  - query strings are dropped, so student search terms and filters are never logged.
 */
export function redactUrl(url) {
  if (typeof url !== 'string' || url === '') return url;
  return url
    .split('?')[0]
    .split('#')[0]
    .replace(/(\/public\/enroll\/)[^/]+/g, '$1[redacted]')
    .replace(/(\/join\/)[^/]+/g, '$1[redacted]');
}

// morgan's built-in formats read these tokens; both now go through redactUrl.
morgan.token('url', (req) => redactUrl(req.originalUrl || req.url));
morgan.token('referrer', (req) => redactUrl(req.headers.referer || req.headers.referrer));

/** HTTP access log with redacted URLs. `stream` is for tests; by default it writes to stdout. */
export function createRequestLogger({ format, stream } = {}) {
  return morgan(format, stream ? { stream } : undefined);
}
