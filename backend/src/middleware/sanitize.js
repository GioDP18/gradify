import { ApiError } from '../utils/ApiError.js';

const MAX_DEPTH = 20;

function isUnsafeKey(key) {
  return key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/** Returns the path of the first unsafe key found, or null. */
export function findUnsafeKey(value, path = '', depth = 0) {
  if (depth > MAX_DEPTH) return path || '(root)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findUnsafeKey(value[i], `${path}[${i}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isUnsafeKey(key)) return childPath;
      const found = findUnsafeKey(value[key], childPath, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * NoSQL-injection guard. Rejects any request whose body, query, or params contain
 * MongoDB operator keys ($gt, $where, …), dotted paths, or prototype-pollution keys.
 * Rejecting (rather than silently stripping) makes tampering visible and keeps data intact.
 */
export function rejectUnsafeKeys(req, res, next) {
  // No endpoint accepts a list in the query string; ?x=a&x=b would otherwise reach code expecting a string.
  const repeated = Object.entries(req.query ?? {}).find(([, value]) => Array.isArray(value));
  if (repeated) {
    return next(ApiError.badRequest('That request is not valid.', { source: 'query', field: repeated[0] }));
  }
  for (const [source, value] of [['body', req.body], ['query', req.query], ['params', req.params]]) {
    const unsafe = findUnsafeKey(value);
    if (unsafe) {
      return next(ApiError.badRequest('That request is not valid.', { source, field: unsafe }));
    }
  }
  return next();
}
