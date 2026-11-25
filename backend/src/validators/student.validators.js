import { body, query } from 'express-validator';
import { STUDENT_STATUSES } from '../models/Student.js';
import { ENROLLMENT_STATUSES } from '../models/Enrollment.js';
import { SORTABLE_FIELDS } from '../services/student.service.js';

const text = (name, max) => query(name).optional().isString().trim().isLength({ max }).withMessage('That is too long.');

/** Filters shared by the list and export endpoints. */
export const studentFilterRules = [
  text('search', 100),
  text('course', 60),
  text('section', 30),
  query('yearLevel').optional().isInt({ min: 1, max: 6 }).withMessage('Year level must be 1 to 6.').toInt(),
  query('status').optional().isIn(STUDENT_STATUSES).withMessage('That filter is not valid.'),
  query('classId').optional().isMongoId().withMessage('Choose a class.'),
  query('enrollment').optional().isIn(Object.values(ENROLLMENT_STATUSES)).withMessage('That filter is not valid.'),
  query('archived').optional().isBoolean().withMessage('That choice is not valid.').toBoolean(),
  query('sort').optional().isIn(SORTABLE_FIELDS).withMessage('That sorting is not available.'),
  query('order').optional().isIn(['asc', 'desc']).withMessage('That sorting is not available.'),
];

export const listStudentRules = [
  ...studentFilterRules,
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('That page does not exist.').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('That is too many to show at once.').toInt(),
];

export const createStudentQueryRules = [
  query('classId').optional().isMongoId().withMessage('Choose a class.'),
];

export const importRules = [
  query('classId').optional().isMongoId().withMessage('Choose a class.'),
  query('dryRun').optional().isBoolean().withMessage('That choice is not valid.').toBoolean(),
  query('skipInvalid').optional().isBoolean().withMessage('That choice is not valid.').toBoolean(),
];

export const enrollRules = [
  body('studentIds').isArray({ min: 1, max: 500 }).withMessage('Choose between 1 and 500 students.'),
  body('studentIds.*').custom((v) => typeof v === 'string').withMessage('One of the students was not found. Reload and try again.').bail().isMongoId().withMessage('One of the students was not found. Reload and try again.'),
];

export const enrollmentStatusRules = [
  body('status').isIn(Object.values(ENROLLMENT_STATUSES)).withMessage('Choose Enrolled or Dropped.'),
  body('reason').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }).withMessage('Reason must be at most 300 characters'),
];
