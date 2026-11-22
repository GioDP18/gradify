import mongoose from 'mongoose';

// ADMIN manages instructor accounts and the shared grading criteria (D22); it has no classes.
export const ROLES = Object.freeze({ INSTRUCTOR: 'INSTRUCTOR', ADMIN: 'ADMIN', STUDENT: 'STUDENT' });
export const USER_STATUSES = Object.freeze({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' });

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is invalid'],
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 40,
      match: [/^[a-z0-9._-]+$/, 'Username may contain letters, numbers, dots, dashes, and underscores only'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true },
    status: { type: String, enum: Object.values(USER_STATUSES), default: USER_STATUSES.ACTIVE },
    // Reserved for a future student portal: links a STUDENT account to its student record.
    studentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
    // Embedded in every access token as `tv`. Raising it ends all of the account's access tokens
    // at once (logout, password change, admin reset, disable).
    tokenVersion: { type: Number, default: 0 },
    // Profile photo (small, resized in the browser). Bytes load only when explicitly selected.
    avatar: {
      type: new mongoose.Schema({ data: { type: Buffer, required: true }, contentType: { type: String, required: true } }, { _id: false }),
      select: false,
    },
    avatarUpdatedAt: { type: Date },
    // Personal app settings (Settings page).
    preferences: {
      // true: one "working class" is shared by every class page; false: each page picks its own class.
      workingClass: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
    collection: 'users',
    toJSON: {
      versionKey: false,
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.failedLoginCount;
        delete ret.lockUntil;
        delete ret.avatar;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });

/** Public shape returned by the API. */
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    username: this.username ?? null,
    role: this.role,
    status: this.status,
    lastLoginAt: this.lastLoginAt ?? null,
    // Changes whenever the photo changes, so clients can cache it by this value; null = no photo.
    avatarUpdatedAt: this.avatarUpdatedAt ?? null,
    preferences: { workingClass: this.preferences?.workingClass ?? true },
  };
};

export const User = mongoose.model('User', userSchema);
