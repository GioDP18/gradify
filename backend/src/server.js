import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase, supportsTransactions } from './config/db.js';
import { createApp } from './app.js';
import { sweep } from './services/grading/grading.service.js';
import { applyAuditRetention } from './services/auditRetention.service.js';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function start() {
  try {
    await connectDatabase({
      uri: env.mongodb.uri,
      dbName: env.mongodb.dbName,
      dnsServers: env.mongodb.dnsServers,
      // Indexes build automatically in development; production uses the init-indexes script.
      autoIndex: !env.isProduction,
    });
    if (!(await supportsTransactions())) {
      logger.warn('MongoDB deployment does not support transactions (not a replica set). See README.');
    }
  } catch (error) {
    logger.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  const server = createApp().listen(env.port, () => {
    logger.info(`API listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Grading safety net: retry failed/stale recalculations and apply INC lapses (D18).
  const runSweep = () =>
    sweep()
      .then(({ classes }) => classes && logger.info(`Grade sweep checked ${classes} class(es)`))
      .catch((error) => logger.error('Grade sweep failed:', error.message))
      .then(() => applyAuditRetention())
      .then((audit) => audit && (audit.anonymized || audit.routineDeleted || audit.expiredDeleted) && logger.info(`Audit retention: ${audit.anonymized} anonymized, ${audit.routineDeleted + audit.expiredDeleted} deleted`))
      .catch((error) => logger.error('Audit retention failed:', error.message));
  runSweep();
  setInterval(runSweep, SWEEP_INTERVAL_MS).unref();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down…`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
