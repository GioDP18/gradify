import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { rejectUnsafeKeys } from './middleware/sanitize.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import apiRoutes from './routes/index.js';

/**
 * Builds the Express application without starting a server (tests use it directly).
 * `beforeRoutes` (optional) runs before every API request — the serverless entry point uses it
 * to make sure the database connection is ready.
 */
const BODYLESS_PATHS = new Set(['/api/auth/logout', '/api/auth/refresh']);

export function createApp({ beforeRoutes } = {}) {
  const app = express();

  app.set('trust proxy', env.trustProxy);
  // "simple" = Node's querystring parser: no nested objects, so ?a[$ne]=x cannot build an operator object.
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: env.clientUrls,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
  // Logout and refresh take no body (they use the cookie). They skip the JSON parser, so a body the
  // parser would refuse (e.g. a literal `null`) can never stop a session from being ended.
  const parseJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (BODYLESS_PATHS.has(req.path) ? next() : parseJson(req, res, next)));
  app.use(cookieParser());
  // Access log; enrollment tokens and query strings are redacted (see requestLogger.js).
  if (!env.isTest) app.use(createRequestLogger({ format: env.isProduction ? 'combined' : 'dev' }));

  if (beforeRoutes) app.use('/api', beforeRoutes);
  app.use('/api', apiLimiter, rejectUnsafeKeys, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
