import mongoose from 'mongoose';

export const ENROLLMENT_STATUSES = Object.freeze({ ENROLLED: 'ENROLLED', DROPPED: 'DROPPED' });

/**
 * Links a student to a class. A DROPPED enrollment yields the special mark "DRP"
 * instead of a computed grade (Handbook §53e); its history is kept.
 */
const enrollmentSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, immutable: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true },
    status: { type: String, enum: Object.values(ENROLLMENT_STATUSES), default: ENROLLMENT_STATUSES.ENROLLED },
    enrolledAt: { type: Date, default: () => new Date() },
    droppedAt: { type: Date, default: null },
    dropReason: { type: String, trim: true, maxlength: 300, default: null },
  },
  { timestamps: true, collection: 'enrollments', versionKey: false },
);

enrollmentSchema.index({ class: 1, student: 1 }, { unique: true });
enrollmentSchema.index({ student: 1 });
enrollmentSchema.index({ class: 1, status: 1 });

export const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
