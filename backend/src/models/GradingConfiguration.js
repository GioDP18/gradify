import mongoose from 'mongoose';

/**
 * Versioned grading rules shared by every instructor (D21, superseding D11's per-instructor scope).
 * Version 1 is the official criteria; only the administrator creates new versions. Versions are append-only: a change creates a new version and
 * activates it; older versions are never overwritten (computed grades reference the version used).
 */
const componentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    weight: { type: Number, required: true },
    source: { type: String, required: true },
  },
  { _id: false },
);

const gradingConfigurationSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, immutable: true },
    isActive: { type: Boolean, default: false },
    effectiveDate: { type: Date, default: () => new Date() },
    name: { type: String, required: true },
    source: { type: String },
    notes: { type: String, maxlength: 500, default: null },
    periodWeights: { MIDTERM: { type: Number, required: true }, FINALS: { type: Number, required: true } },
    periods: {
      MIDTERM: { label: String, components: [componentSchema] },
      FINALS: { label: String, components: [componentSchema] },
    },
    computationRules: { type: mongoose.Schema.Types.Mixed, required: true },
    roundingRules: { type: mongoose.Schema.Types.Mixed, required: true },
    gradeConversion: { type: mongoose.Schema.Types.Mixed, required: true },
    incompleteRule: { complianceMonths: { type: Number, required: true }, lapseGrade: { type: Number, required: true } },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', immutable: true },
  },
  { timestamps: true, collection: 'gradingConfigurations', versionKey: false },
);

gradingConfigurationSchema.index({ version: 1 }, { unique: true });
// At most one active configuration in the whole system.
gradingConfigurationSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true }, name: 'one_active' });

export const GradingConfiguration = mongoose.model('GradingConfiguration', gradingConfigurationSchema);
