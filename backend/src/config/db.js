import dns from 'node:dns';
import mongoose from 'mongoose';
import { logger } from './logger.js';

const READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

mongoose.set('strictQuery', true);

let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (error) => logger.error('MongoDB connection error:', error.message));
}

/**
 * Connects to MongoDB. Transactions require a replica set (Atlas clusters always are one).
 */
export async function connectDatabase({ uri, dbName, autoIndex, dnsServers = [], maxPoolSize = 10 }) {
  attachListeners();
  // mongodb+srv:// needs an SRV DNS lookup. On some Windows setups Node's resolver points at an
  // unreachable 127.0.0.1; DNS_SERVERS lets the deployment name working resolvers explicitly.
  if (dnsServers.length > 0) dns.setServers(dnsServers);
  await mongoose.connect(uri, {
    dbName,
    autoIndex,
    maxPoolSize,
    serverSelectionTimeoutMS: 15000,
  });
  const { host, name } = mongoose.connection;
  logger.info(`MongoDB connected (database: ${name}, host: ${host})`);
  return mongoose.connection;
}

let pendingConnection = null;

/**
 * Serverless-safe connection: every function invocation awaits the same cached connection
 * (reused across warm invocations), and a failed attempt is retried on the next request.
 */
export function ensureDatabaseConnection(options) {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (!pendingConnection) {
    pendingConnection = connectDatabase(options).catch((error) => {
      pendingConnection = null;
      throw error;
    });
  }
  return pendingConnection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function getDatabaseStatus() {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}

/** True when the connected deployment can run multi-document transactions. */
export async function supportsTransactions() {
  if (mongoose.connection.readyState !== 1) return false;
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  return Boolean(hello.setName || hello.msg === 'isdbgrid');
}
