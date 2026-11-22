import { getDatabaseStatus } from '../config/db.js';
import { sendSuccess } from '../utils/response.js';

/** Liveness + readiness probe. Returns 503 while the database is unavailable. */
export function getHealth(req, res) {
  const database = getDatabaseStatus();
  const healthy = database === 'connected';
  return sendSuccess(
    res,
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'gradify-api',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
