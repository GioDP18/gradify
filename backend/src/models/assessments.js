import mongoose from 'mongoose';
import { GRADING_PERIODS } from './constants.js';

/**
 * Written quizzes, performance activities, and examinations share one shape but are stored in
 * their own collections (with their own score collections), as the specification requires.
 */
export const ASSESSMENT_STATUSES = Object.freeze({ DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' });

function assessmentSchema(collection) {
  const schema = new mongoose.Schema(
    {
      class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, immutable: true },
      title: { type: String, required: true, trim: true, maxlength: 150 },
      description: { type: String, trim: true, maxlength: 1000, default: null },
      instructions: { type: String, trim: true, maxlength: 2000, default: null },
      period: { type: String, enum: GRADING_PERIODS, required: true },
      date: { type: Date, required: true },
      maxScore: { type: Number, required: true, min: 0.01, max: 10000 },
      // Only PUBLISHED items count toward grades; DRAFT items are being prepared.
      status: { type: String, enum: Object.values(ASSESSMENT_STATUSES), default: ASSESSMENT_STATUSES.PUBLISHED },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
      // Incremented on every score save; rejects stale saves from another tab or device.
      revision: { type: Number, default: 0 },
      // Soft delete: the item stops counting, but its scores are preserved.
      deletedAt: { type: Date, default: null },
      deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true, collection, versionKey: false },
  );
  schema.index({ class: 1, period: 1, deletedAt: 1, date: -1 });
  return schema;
}

function scoreSchema(collection, refField, refModel) {
  const schema = new mongoose.Schema(
    {
      student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true },
      [refField]: { type: mongoose.Schema.Types.ObjectId, ref: refModel, required: true, immutable: true },
      // Copied from the assessment so scores can never disagree with it about class or period.
      class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, immutable: true },
      period: { type: String, enum: GRADING_PERIODS, required: true },
      // A document exists only when a score was entered. "No score" = no document (never 0).
      score: { type: Number, required: true, min: 0 },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true, collection, versionKey: false },
  );
  schema.index({ [refField]: 1, student: 1 }, { unique: true });
  schema.index({ class: 1, period: 1, student: 1 });
  schema.index({ student: 1 });
  return schema;
}

function define({ model, collection, scoreModel, scoreCollection, refField }) {
  const Assessment = mongoose.models[model] ?? mongoose.model(model, assessmentSchema(collection));
  const Score = mongoose.models[scoreModel] ?? mongoose.model(scoreModel, scoreSchema(scoreCollection, refField, model));
  return { Assessment, Score };
}

export const { Assessment: WrittenQuiz, Score: QuizScore } = define({
  model: 'WrittenQuiz', collection: 'writtenQuizzes', scoreModel: 'QuizScore', scoreCollection: 'quizScores', refField: 'quiz',
});
export const { Assessment: PerformanceActivity, Score: ActivityScore } = define({
  model: 'PerformanceActivity', collection: 'performanceActivities', scoreModel: 'ActivityScore', scoreCollection: 'activityScores', refField: 'activity',
});
export const { Assessment: Examination, Score: ExaminationScore } = define({
  model: 'Examination', collection: 'examinations', scoreModel: 'ExaminationScore', scoreCollection: 'examinationScores', refField: 'examination',
});

/** Registry used by the shared service/routes and by the grading engine. */
export const ASSESSMENT_TYPES = Object.freeze({
  quizzes: {
    key: 'quizzes', Assessment: WrittenQuiz, Score: QuizScore, refField: 'quiz',
    singular: 'Quiz', auditPrefix: 'QUIZ', collection: 'writtenQuizzes', componentSource: 'writtenQuizzes',
  },
  activities: {
    key: 'activities', Assessment: PerformanceActivity, Score: ActivityScore, refField: 'activity',
    singular: 'Activity', auditPrefix: 'ACTIVITY', collection: 'performanceActivities', componentSource: 'performanceActivities',
  },
  examinations: {
    key: 'examinations', Assessment: Examination, Score: ExaminationScore, refField: 'examination',
    singular: 'Examination', auditPrefix: 'EXAMINATION', collection: 'examinations', componentSource: 'examinations',
  },
});
