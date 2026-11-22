import mongoose from 'mongoose';

export const STUDENT_STATUSES = Object.freeze(['ENROLLED', 'DROPPED', 'INACTIVE']);

/**
 * Student master record. Owned by one instructor (their roster).
 * Academic data (attendance, scores, grades) live in their own collections — never here.
 */
const studentSchema = new mongoose.Schema(
  {
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    studentNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    middleName: { type: String, trim: true, maxlength: 60, default: null },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    course: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
    yearLevel: { type: Number, required: true, min: 1, max: 6 },
    section: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    enrollmentStatus: { type: String, enum: STUDENT_STATUSES, default: 'ENROLLED' },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Accent-free, lowercase copy of number + names + email so "pena" finds "Peña" (maintained automatically).
    searchKey: { type: String, select: false },
  },
  { timestamps: true, collection: 'students', versionKey: false },
);

/** Lowercases and strips diacritics: "María Peña" → "maria pena". */
export function foldForSearch(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

studentSchema.pre('validate', function buildSearchKey() {
  this.searchKey = foldForSearch([this.studentNumber, this.firstName, this.middleName, this.lastName, this.email].filter(Boolean).join(' '));
});

studentSchema.index({ instructor: 1, studentNumber: 1 }, { unique: true });
studentSchema.index({ instructor: 1, archivedAt: 1, lastName: 1, firstName: 1 });
studentSchema.index({ instructor: 1, course: 1, yearLevel: 1, section: 1 });
studentSchema.index({ instructor: 1, enrollmentStatus: 1 });

/** "Dela Cruz, Juan P." */
export function formatFullName({ firstName, middleName, lastName }) {
  const middleInitial = middleName ? ` ${middleName.trim()[0].toUpperCase()}.` : '';
  return `${lastName}, ${firstName}${middleInitial}`;
}

studentSchema.virtual('fullName').get(function fullName() {
  return formatFullName(this);
});

export const Student = mongoose.model('Student', studentSchema);
