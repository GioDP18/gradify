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
import { logger } from '../src/config/logger.js';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/utils/ApiError.js';
import { seedOnStartup } from '../src/services/seed.service.js';

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
  } catch (error) {
    // The user gets a short message; the reason (network access, credentials, DNS) goes to the log.
    logger.error(`[${req.id}] Could not connect to MongoDB:`, error?.name, String(error?.message ?? error).replace(/\/\/[^@/]*@/, '//<credentials>@'));
    return next(ApiError.unavailable('The database is temporarily unavailable. Please try again shortly.'));
  }
  // A new deployment starts with a cold instance: seed an empty database before its first request
  // is served (only when SEED_DATABASE=true; once per instance; never fails the request).
  await seedOnStartup();
  return next();
}

export default createApp({ beforeRoutes: requireDatabase });
