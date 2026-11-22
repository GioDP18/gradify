import mongoose from 'mongoose';
import { GRADING_PERIODS } from './constants.js';

/**
 * One class meeting on one calendar date in one grading period.
 * sessionDate is stored as 00:00 UTC of the calendar date (a date, not an instant).
 */
const attendanceSessionSchema = new mongoose.Schema(
  {
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, immutable: true },
    sessionDate: { type: Date, required: true },
    period: { type: String, enum: GRADING_PERIODS, required: true },
    description: { type: String, trim: true, maxlength: 300, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    // Incremented on every save of the records; used to reject stale saves from another tab.
    revision: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'attendanceSessions', versionKey: false },
);

attendanceSessionSchema.index({ class: 1, sessionDate: 1, period: 1 }, { unique: true });
attendanceSessionSchema.index({ class: 1, period: 1, sessionDate: -1 });

export const AttendanceSession = mongoose.model('AttendanceSession', attendanceSessionSchema);
