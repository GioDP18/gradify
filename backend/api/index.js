/**
 * Vercel serverless entry point. Every request (see vercel.json rewrites) is handled by the
 * same Express app used locally; the database connection is cached across warm invocations.
 *
 * Grade recalculation runs inside the request that changes data (after its transaction commits)
 * and completes before the response is sent, so nothing depends on background work surviving
 * after the function returns. The periodic grade sweep runs via Vercel Cron (/api/internal/sweep).
 */
import { env } from '../src/config/env.js';
import { ensureDatabaseConnection } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/utils/ApiError.js';

const connectionOptions = {
  uri: env.mongodb.uri,
  dbName: env.mongodb.dbName,
  autoIndex: false, // indexes are created once with `npm run db:init`
  dnsServers: env.mongodb.dnsServers,
  maxPoolSize: 5, // many short-lived function instances share one Atlas cluster
};

async function requireDatabase(req, res, next) {
  try {
    await ensureDatabaseConnection(connectionOptions);
    next();
  } catch {
    next(ApiError.unavailable('The database is temporarily unavailable. Please try again shortly.'));
  }
}

export default createApp({ beforeRoutes: requireDatabase });
