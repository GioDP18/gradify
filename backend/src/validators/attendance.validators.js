import { body, query } from 'express-validator';
import { GRADING_PERIODS, ATTENDANCE_STATUSES } from '../models/constants.js';
import { parseDateOnly } from '../utils/dates.js';

const dateOnly = (chain, label) =>
  chain.custom((v) => typeof v === 'string' && parseDateOnly(v) !== null).withMessage(`${label} is not a valid date.`);

export const listSessionRules = [
  query('classId').isMongoId().withMessage('Choose a class.'),
  query('period').optional().isIn(GRADING_PERIODS).withMessage('Choose Midterm or Finals.'),
  dateOnly(query('from').optional(), 'from'),
  dateOnly(query('to').optional(), 'to'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('That is too many to show at once.').toInt(),
];

export const createSessionRules = [
  body('classId').isMongoId().withMessage('Choose a class.'),
  body('period').isIn(GRADING_PERIODS).withMessage('Choose Midterm or Finals.'),
  dateOnly(body('sessionDate'), 'Session date'),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }).withMessage('Description must be at most 300 characters'),
];

export const updateSessionRules = [
  body('period').optional().isIn(GRADING_PERIODS).withMessage('Choose Midterm or Finals.'),
  dateOnly(body('sessionDate').optional(), 'Session date'),
  body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }).withMessage('Description must be at most 300 characters'),
];

export const updateRecordsRules = [
  body('revision').isInt({ min: 0 }).withMessage('Reload the page and try again.').toInt(),
  body('records').isArray({ min: 1, max: 1000 }).withMessage('Mark between 1 and 1,000 students.'),
  body('records.*.studentId').custom((v) => typeof v === 'string').withMessage('One of the students was not found. Reload and try again.').bail().isMongoId().withMessage('One of the students was not found. Reload and try again.'),
  body('records.*.status').isIn(ATTENDANCE_STATUSES).withMessage('Choose Present, Absent, or Excused.'),
];

export const summaryRules = [
  query('classId').optional().isMongoId().withMessage('Choose a class.'),
  query('studentId').optional().isMongoId().withMessage('Choose a student.'),
  query('period').optional().isIn(GRADING_PERIODS).withMessage('Choose Midterm or Finals.'),
];
