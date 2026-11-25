/**
 * Creates every collection and index the application needs (idempotent — safe to run again).
 * Production disables automatic index builds, so run this once per database and after upgrades:
 *
 *   npm run db:init
 *
 * Existing indexes are never dropped. Uses MONGODB_URI / MONGODB_DB_NAME from backend/.env
 * (or the environment).
 */
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase, supportsTransactions } from '../config/db.js';
import { createCollectionsAndIndexes } from '../services/seed.service.js';

async function main() {
  await connectDatabase({ uri: env.mongodb.uri, dbName: env.mongodb.dbName, autoIndex: false, dnsServers: env.mongodb.dnsServers });
  if (!(await supportsTransactions())) {
    console.warn('WARNING: this MongoDB deployment is not a replica set — transactions are unavailable. Use Atlas or a replica set in production.');
  }
  await createCollectionsAndIndexes((model, indexes) => {
    console.log(`✓ ${model.collection.collectionName.padEnd(22)} ${indexes.length} index(es)`);
  });
  console.log(`Database "${env.mongodb.dbName}" is ready.`);
}

main()
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase().catch(() => {}));
