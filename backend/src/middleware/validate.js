import { validationResult, matchedData } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

/**
 * Runs express-validator chains, rejects with 422 on failure, and replaces req.body
 * with only the validated fields (unknown fields are dropped).
 */
export function validate(chains) {
  return async (req, res, next) => {
    for (const chain of chains) {
      await chain.run(req);
    }
    const result = validationResult(req);
    if (!result.isEmpty()) {
      const details = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
      return next(ApiError.validation(details));
    }
    req.body = matchedData(req, { locations: ['body'], includeOptionals: true });
    req.validatedQuery = matchedData(req, { locations: ['query'], includeOptionals: false });
    return next();
  };
}
