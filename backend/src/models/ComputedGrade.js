import mongoose from 'mongoose';

export const GRADE_PERIODS = Object.freeze(['MIDTERM', 'FINALS', 'OVERALL']);
export const CALC_STATUSES = Object.freeze({ CURRENT: 'CURRENT', STALE: 'STALE', FAILED: 'FAILED' });

/**
 * Persisted output of the grading engine — a derived record, never the source of raw scores.
 * Exactly one document per student × class × academic period × grading period.
 *
 * Consistency: every source change increments sourceRevision (inside the change's transaction)
 * and marks the record STALE. A recalculation stores its result only if sourceRevision still
 * equals the revision it started from (calculatedRevision). A grade is current only when
 * calcStatus = CURRENT and calculatedRevision === sourceRevision.
 */
const componentSchema = new mongoose.Schema(
  {
    key: String,
    label: String,
    weight: Number,
    itemCount: Number,
    scoredCount: Number,
    rawScore: Number,
    maxScore: Number,
    present: Number,
    absent: Number,
    excused: Number,
    percentage: Number,
    weightedContribution: Number,
    empty: Boolean,
  },
  { _id: false },
);

const computedGradeSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    schoolYear: { type: String, required: true },
    semester: { type: String, required: true },
    period: { type: String, enum: GRADE_PERIODS, required: true },

    configuration: { type: mongoose.Schema.Types.ObjectId, ref: 'GradingConfiguration', default: null },
    configVersion: { type: Number, default: null },
    calculationVersion: { type: String, default: null },

    components: { type: [componentSchema], default: [] }, // MIDTERM / FINALS breakdown
    periodResults: { type: mongoose.Schema.Types.Mixed, default: null }, // OVERALL: inputs used
    missingItems: { type: mongoose.Schema.Types.Mixed, default: [] },
    emptyComponents: { type: mongoose.Schema.Types.Mixed, default: [] },
    percentage: { type: Number, default: null }, // full precision
    roundedPercent: { type: Number, default: null },
    grade: { type: Number, default: null },
    remarks: { type: String, default: null },
    completionStatus: { type: String, default: null },
    incDeadline: { type: Date, default: null },
    lapsedAt: { type: Date, default: null }, // INC lapsed to 5.0 — frozen (D18)

    calcStatus: { type: String, enum: Object.values(CALC_STATUSES), default: CALC_STATUSES.STALE },
    sourceRevision: { type: Number, default: 0 },
    calculatedRevision: { type: Number, default: -1 },
    lastCalculatedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true, collection: 'computedGrades', versionKey: false },
);

computedGradeSchema.index({ student: 1, class: 1, schoolYear: 1, semester: 1, period: 1 }, { unique: true });
computedGradeSchema.index({ class: 1, period: 1, calcStatus: 1 });
computedGradeSchema.index({ calcStatus: 1 });
computedGradeSchema.index({ period: 1, completionStatus: 1, incDeadline: 1 });

export const ComputedGrade = mongoose.model('ComputedGrade', computedGradeSchema);
