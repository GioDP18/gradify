import mongoose from 'mongoose';

/**
 * Server-side record of an issued refresh token. Only an HMAC of the token is stored,
 * so a database leak does not expose usable tokens. Tokens rotate on every use; reuse of
 * a rotated token revokes the whole family (theft detection).
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    family: { type: String, required: true },
    remember: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: ['ROTATED', 'LOGOUT', 'REUSE_DETECTED', 'ACCOUNT_DISABLED', 'PASSWORD_CHANGED', null], default: null },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: true, collection: 'refreshTokens' },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ user: 1 });
refreshTokenSchema.index({ family: 1 });
// MongoDB removes expired token records automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
