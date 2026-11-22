import { body, query } from 'express-validator';
import { GRADING_PERIODS, ATTENDANCE_STATUSES } from '../models/constants.js';
import { parseDateOnly } from '../utils/dates.js';

const dateOnly = (chain, label) =>
  chain.custom((v) => typeof v === 'string' && parseDateOnly(v) !== null).withMessage(`${label} must be a real calendar date (YYYY-MM-DD)`);

export const listSessionRules = [
  query('classId').isMongoId().withMessage('classId is required'),
  query('period').optional().isIn(GRADING_PERIODS).withMessage('period must be MIDTERM or FINALS'),
  dateOnly(query('from').optional(), 'from'),
  dateOnly(query('to').optional(), 'to'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be 1–200').toInt(),
];

export const createSessionRules = [
  body('classId').isMongoId().withMessage('classId is required'),
  body('period').isIn(GRADING_PERIODS).withMessage('Grading period must be MIDTERM or FINALS'),
  dateOnly(body('sessionDate'), 'Session date'),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }).withMessage('Description must be at most 300 characters'),
];

export const updateSessionRules = [
  body('period').optional().isIn(GRADING_PERIODS).withMessage('Grading period must be MIDTERM or FINALS'),
  dateOnly(body('sessionDate').optional(), 'Session date'),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }).withMessage('Description must be at most 300 characters'),
];

export const updateRecordsRules = [
  body('revision').isInt({ min: 0 }).withMessage('revision is required').toInt(),
  body('records').isArray({ min: 1, max: 1000 }).withMessage('records must be a list of 1–1000 entries'),
  body('records.*.studentId').custom((v) => typeof v === 'string').withMessage('Every record needs a valid studentId').bail().isMongoId().withMessage('Every record needs a valid studentId'),
  body('records.*.status').isIn(ATTENDANCE_STATUSES).withMessage('Status must be PRESENT, ABSENT, or EXCUSED'),
];

export const summaryRules = [
  query('classId').optional().isMongoId().withMessage('classId must be a valid ID'),
  query('studentId').optional().isMongoId().withMessage('studentId must be a valid ID'),
  query('period').optional().isIn(GRADING_PERIODS).withMessage('period must be MIDTERM or FINALS'),
];
