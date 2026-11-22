/**
 * Creates every collection and index the application needs (idempotent — safe to run again).
 * Production disables automatic index builds, so run this once per database and after upgrades:
 *
 *   npm run db:init
 *
 * Existing indexes are never dropped. Uses MONGODB_URI / MONGODB_DB_NAME from backend/.env
 * (or the environment).
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase, supportsTransactions } from '../config/db.js';
import '../models/User.js';
import '../models/RefreshToken.js';
import '../models/AuditLog.js';
import '../models/Class.js';
import '../models/Student.js';
import '../models/Enrollment.js';
import '../models/AttendanceSession.js';
import '../models/AttendanceRecord.js';
import '../models/assessments.js';
import '../models/GradingConfiguration.js';
import '../models/ComputedGrade.js';
import '../models/RateLimitHit.js';

async function main() {
  await connectDatabase({ uri: env.mongodb.uri, dbName: env.mongodb.dbName, autoIndex: false, dnsServers: env.mongodb.dnsServers });
  if (!(await supportsTransactions())) {
    console.warn('WARNING: this MongoDB deployment is not a replica set — transactions are unavailable. Use Atlas or a replica set in production.');
  }
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch((error) => {
      if (error?.codeName !== 'NamespaceExists') throw error;
    });
    await model.createIndexes();
    const indexes = await model.collection.indexes();
    console.log(`✓ ${model.collection.collectionName.padEnd(22)} ${indexes.length} index(es)`);
  }
  console.log(`Database "${env.mongodb.dbName}" is ready.`);
}

main()
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase().catch(() => {}));
