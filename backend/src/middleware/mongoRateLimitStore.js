import { RateLimitHit } from '../models/RateLimitHit.js';

/**
 * express-rate-limit store backed by MongoDB, so limits hold across every serverless instance.
 * Each window is one document; the increment is a single atomic pipeline update.
 */
export class MongoRateLimitStore {
  constructor({ prefix }) {
    this.prefix = prefix;
    this.localKeys = false; // counts are shared between instances
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  key(key) {
    return `${this.prefix}:${key}`;
  }

  async increment(key) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);
    const doc = await RateLimitHit.findOneAndUpdate(
      { _id: this.key(key) },
      [
        {
          $set: {
            // Start a fresh window when the previous one has expired (or none exists).
            hits: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: ['$hits', 1] }, 1] },
            expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', resetAt] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after', updatePipeline: true },
    ).lean();
    return { totalHits: doc.hits, resetTime: doc.expiresAt };
  }

  async decrement(key) {
    await RateLimitHit.updateOne({ _id: this.key(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await RateLimitHit.deleteOne({ _id: this.key(key) });
  }
}
