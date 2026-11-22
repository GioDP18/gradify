import { randomUUID } from 'node:crypto';

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Tags each request with an ID (reused from a trusted upstream header when well-formed). */
export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
