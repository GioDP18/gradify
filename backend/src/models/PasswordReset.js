import mongoose from 'mongoose';

/**
 * One emailed "reset my password" link. Only an HMAC of the link's token is stored, so a copy of
 * the database cannot be used to reset anyone's password. A link works once, for a short time;
 * asking again replaces the earlier link.
 */
const passwordResetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: true, collection: 'passwordResets', versionKey: false },
);

passwordResetSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetSchema.index({ user: 1, createdAt: -1 });
// Kept for a day after it ends (so the hourly limit per account can count it), then removed by MongoDB.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
