import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

let transactionsUnavailable = false;
const afterCommitHooks = new WeakMap();

function isNoReplicaSetError(error) {
  return error?.code === 20 || /Transaction numbers are only allowed on a replica set/i.test(error?.message ?? '');
}

async function runHooks(hooks) {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (error) {
      logger.error('after-commit hook failed:', error?.stack || error);
    }
  }
}

/**
 * Registers work to run only after the surrounding transaction has committed
 * (e.g. grade recalculation, which must read the committed data).
 * Without a transaction (session null) the work runs immediately.
 */
export async function afterCommit(session, fn) {
  const hooks = session ? afterCommitHooks.get(session) : null;
  if (!hooks) {
    await runHooks([fn]);
    return;
  }
  hooks.push(fn);
}

/**
 * Runs fn(session) inside a MongoDB transaction (retried automatically on transient errors),
 * then runs any after-commit hooks registered during the final, committed attempt.
 * On a standalone server without replica-set support it runs fn(null) once and logs a warning;
 * production deployments must use a replica set (see README).
 */
export async function runInTransaction(fn) {
  if (transactionsUnavailable) return fn(null);
  const session = await mongoose.startSession();
  let hooks = [];
  try {
    let result;
    await session.withTransaction(async () => {
      hooks = []; // a retried attempt must not inherit hooks from an aborted one
      afterCommitHooks.set(session, hooks);
      result = await fn(session);
    });
    afterCommitHooks.delete(session);
    await runHooks(hooks);
    return result;
  } catch (error) {
    afterCommitHooks.delete(session);
    if (!isNoReplicaSetError(error)) throw error;
    transactionsUnavailable = true;
    logger.warn('MongoDB transactions unavailable (not a replica set); continuing without them.');
    return fn(null);
  } finally {
    await session.endSession();
  }
}
