import mongoose from 'mongoose';

export const SEMESTERS = Object.freeze(['FIRST', 'SECOND', 'SUMMER']);
export const CLASS_STATUSES = Object.freeze({ ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' });

/**
 * A class = one subject + section taught by one instructor in one term.
 * It is the "academic context" every attendance session, assessment, and computed grade belongs to.
 */
const classSchema = new mongoose.Schema(
  {
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    subjectCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    subjectTitle: { type: String, required: true, trim: true, maxlength: 150 },
    section: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    schoolYear: {
      type: String,
      required: true,
      validate: {
        validator: (v) => {
          const m = /^(\d{4})-(\d{4})$/.exec(v);
          return Boolean(m) && Number(m[2]) === Number(m[1]) + 1;
        },
        message: 'School year must look like 2026-2027',
      },
    },
    semester: { type: String, enum: SEMESTERS, required: true },
    // End of the term. INC deadlines are termEndDate + 1 year (Handbook §53c, §55.1).
    termEndDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(CLASS_STATUSES), default: CLASS_STATUSES.ACTIVE },
    archivedAt: { type: Date, default: null },
    // QR self-enrollment: off by default. The token is the private part of the join link; a new
    // token makes earlier QR codes and links stop working.
    selfEnrollment: {
      open: { type: Boolean, default: false },
      token: { type: String, default: null },
      changedAt: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: 'classes', versionKey: false },
);

classSchema.index({ instructor: 1, subjectCode: 1, section: 1, schoolYear: 1, semester: 1 }, { unique: true });
classSchema.index({ instructor: 1, status: 1, schoolYear: -1 });
classSchema.index({ 'selfEnrollment.token': 1 }, { unique: true, partialFilterExpression: { 'selfEnrollment.token': { $type: 'string' } } });

export const Class = mongoose.model('Class', classSchema);
