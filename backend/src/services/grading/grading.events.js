import { logger } from '../../config/logger.js';

/**
 * Single integration point between source-data modules (attendance, quizzes, activities,
 * examinations, enrollments) and the grading engine.
 *
 * Every service that changes data a grade depends on calls notifySourceChanged() with the
 * affected class, period(s), and students, inside its transaction when it has one. The
 * grading engine (Phase 7) attaches a handler that marks the affected computed grades stale
 * and recalculates them. Until a handler is registered, calls only log at debug level.
 */
const handlers = new Set();

export function onSourceChanged(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
 * @param {{ classId: any, periods: string[], studentIds?: any[] | 'ALL', reason: string, userId?: any }} change
 * @param {{ session?: import('mongoose').ClientSession }} options
 */
export async function notifySourceChanged(change, options = {}) {
  if (handlers.size === 0) {
    logger.debug(`grading: source changed (${change.reason}) — no grading handler registered yet`);
    return;
  }
  for (const handler of handlers) {
    await handler(change, options);
  }
}
