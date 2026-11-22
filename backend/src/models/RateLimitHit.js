import mongoose from 'mongoose';

/**
 * Shared rate-limit counters. Serverless instances do not share memory, so login limits are
 * counted in MongoDB; expired windows are removed automatically by the TTL index.
 */
const rateLimitHitSchema = new mongoose.Schema(
  {
    _id: { type: String }, // limiter prefix + key
    hits: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'rateLimits', versionKey: false },
);

rateLimitHitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitHit = mongoose.model('RateLimitHit', rateLimitHitSchema);
