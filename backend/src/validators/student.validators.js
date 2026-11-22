import { body, query } from 'express-validator';
import { STUDENT_STATUSES } from '../models/Student.js';
import { ENROLLMENT_STATUSES } from '../models/Enrollment.js';
import { SORTABLE_FIELDS } from '../services/student.service.js';

const text = (name, max) => query(name).optional().isString().trim().isLength({ max }).withMessage(`${name} is too long`);

/** Filters shared by the list and export endpoints. */
export const studentFilterRules = [
  text('search', 100),
  text('course', 60),
  text('section', 30),
  query('yearLevel').optional().isInt({ min: 1, max: 6 }).withMessage('yearLevel must be 1–6').toInt(),
  query('status').optional().isIn(STUDENT_STATUSES).withMessage('Invalid status filter'),
  query('classId').optional().isMongoId().withMessage('classId must be a valid ID'),
  query('enrollment').optional().isIn(Object.values(ENROLLMENT_STATUSES)).withMessage('Invalid enrollment filter'),
  query('archived').optional().isBoolean().withMessage('archived must be true or false').toBoolean(),
  query('sort').optional().isIn(SORTABLE_FIELDS).withMessage(`sort must be one of ${SORTABLE_FIELDS.join(', ')}`),
  query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
];

export const listStudentRules = [
  ...studentFilterRules,
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1–100').toInt(),
];

export const createStudentQueryRules = [
  query('classId').optional().isMongoId().withMessage('classId must be a valid ID'),
];

export const importRules = [
  query('classId').optional().isMongoId().withMessage('classId must be a valid ID'),
  query('dryRun').optional().isBoolean().withMessage('dryRun must be true or false').toBoolean(),
  query('skipInvalid').optional().isBoolean().withMessage('skipInvalid must be true or false').toBoolean(),
];

export const enrollRules = [
  body('studentIds').isArray({ min: 1, max: 500 }).withMessage('studentIds must be a list of 1–500 student IDs'),
  body('studentIds.*').custom((v) => typeof v === 'string').withMessage('Every student ID must be valid').bail().isMongoId().withMessage('Every student ID must be valid'),
];

export const enrollmentStatusRules = [
  body('status').isIn(Object.values(ENROLLMENT_STATUSES)).withMessage('status must be ENROLLED or DROPPED'),
  body('reason').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }).withMessage('Reason must be at most 300 characters'),
];
