import { body, query } from 'express-validator';
import { SEMESTERS, CLASS_STATUSES } from '../models/Class.js';

function schoolYearIsConsecutive(value) {
  const m = /^(\d{4})-(\d{4})$/.exec(value);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new Error('School year must look like 2026-2027');
  const start = Number(m[1]);
  if (start < 2000 || start > 2100) throw new Error('School year is out of range');
  return true;
}

function classFields({ optional }) {
  const req = (chain) => (optional ? chain.optional() : chain);
  return [
    req(body('subjectCode'))
      .isString().withMessage('Subject code is required').bail()
      .trim().notEmpty().withMessage('Subject code is required')
      .isLength({ max: 20 }).withMessage('Subject code must be at most 20 characters')
      .matches(/^[A-Za-z0-9 .-]+$/).withMessage('Subject code may contain letters, numbers, spaces, dots, and dashes'),
    req(body('subjectTitle'))
      .isString().withMessage('Subject title is required').bail()
      .trim().notEmpty().withMessage('Subject title is required')
      .isLength({ max: 150 }).withMessage('Subject title must be at most 150 characters'),
    req(body('section'))
      .isString().withMessage('Section is required').bail()
      .trim().notEmpty().withMessage('Section is required')
      .isLength({ max: 30 }).withMessage('Section must be at most 30 characters'),
    req(body('schoolYear'))
      .isString().withMessage('School year is required').bail()
      .trim().custom(schoolYearIsConsecutive),
    req(body('semester')).isIn(SEMESTERS).withMessage('Choose a semester.'),
    req(body('termEndDate'))
      .isISO8601({ strict: true }).withMessage('Enter a valid term end date.').bail()
      .toDate(),
  ];
}

export const createClassRules = classFields({ optional: false });
export const updateClassRules = classFields({ optional: true });
export const listClassRules = [
  query('status').optional().isIn(Object.values(CLASS_STATUSES)).withMessage('That filter is not valid.'),
];
