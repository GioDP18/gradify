import { body, query } from 'express-validator';
import { GRADING_PERIODS } from '../models/constants.js';
import { ASSESSMENT_STATUSES } from '../models/assessments.js';
import { decimalPlaces } from '../services/grading/grading.utils.js';

const STATUSES = Object.values(ASSESSMENT_STATUSES);

function fields({ optional }) {
  const req = (chain) => (optional ? chain.optional() : chain);
  return [
    req(body('title')).isString().withMessage('Title is required').bail().trim().notEmpty().withMessage('Title is required')
      .isLength({ max: 150 }).withMessage('Title must be at most 150 characters'),
    body('description').optional({ values: 'null' }).isString().trim().isLength({ max: 1000 }).withMessage('Description must be at most 1000 characters'),
    body('instructions').optional({ values: 'null' }).isString().trim().isLength({ max: 2000 }).withMessage('Instructions must be at most 2000 characters'),
    req(body('period')).isIn(GRADING_PERIODS).withMessage('Choose Midterm or Finals.'),
    req(body('date')).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Enter a valid date.'),
    req(body('maxScore'))
      .custom((v) => typeof v === 'number' && Number.isFinite(v)).withMessage('Total possible score must be a number').bail()
      .custom((v) => v > 0).withMessage('Total possible score must be greater than zero').bail()
      .custom((v) => v <= 10000).withMessage('Total possible score must be at most 10,000').bail()
      .custom((v) => decimalPlaces(v) <= 2).withMessage('Total possible score may have at most 2 decimal places'),
    body('status').optional().isIn(STATUSES).withMessage('Choose Draft or Published.'),
  ];
}

export const createAssessmentRules = [body('classId').isMongoId().withMessage('Choose a class.'), ...fields({ optional: false })];
export const updateAssessmentRules = fields({ optional: true });

export const listAssessmentRules = [
  query('classId').isMongoId().withMessage('Choose a class.'),
  query('period').optional().isIn(GRADING_PERIODS).withMessage('Choose Midterm or Finals.'),
  query('status').optional().isIn(STATUSES).withMessage('That filter is not valid.'),
  query('search').optional().isString().trim().isLength({ max: 100 }),
];

export const saveScoresRules = [
  body('revision').isInt({ min: 0 }).withMessage('Reload the page and try again.').toInt(),
  body('scores').isArray({ min: 1, max: 1000 }).withMessage('Enter between 1 and 1,000 scores.'),
  body('scores.*.studentId').custom((v) => typeof v === 'string').withMessage('One of the students was not found. Reload and try again.').bail().isMongoId().withMessage('One of the students was not found. Reload and try again.'),
  // number = set the score; null = clear it ("no score entered"). Range checks need the
  // assessment's maximum and happen in the service, with per-student messages.
  body('scores.*.score').custom((v) => v === null || (typeof v === 'number' && Number.isFinite(v))).withMessage('Each score must be a number, or left blank.'),
];
