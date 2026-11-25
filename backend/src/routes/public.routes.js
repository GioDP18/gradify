import { Router } from 'express';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { requireTrustedOrigin } from '../middleware/originCheck.js';
import { selfEnrollLimiter } from '../middleware/rateLimit.js';
import * as selfEnrollment from '../services/selfEnrollment.service.js';
import * as gradeShare from '../services/gradeShare.service.js';
import { sendSuccess } from '../utils/response.js';

/** No sign-in: the QR self-enrollment page, and a student's shared grading sheet. */
const router = Router();
const token = param('token').isString().isLength({ min: 16, max: 64 }).withMessage('This enrollment link is not valid.');
const text = (field) => body(field).optional({ values: 'null' }).isString().withMessage('This value is not valid.').isLength({ max: 254 });

router.get('/enroll/:token', validate([token]), async (req, res) => sendSuccess(res, await selfEnrollment.getJoinInfo(req.params.token)));
router.post(
  '/enroll/:token',
  requireTrustedOrigin,
  selfEnrollLimiter,
  validate([token, ...['studentNumber', 'lastName', 'firstName', 'middleName', 'email', 'course', 'section'].map(text), body('yearLevel').optional(), body('confirmMismatch').optional().isBoolean({ strict: true }).withMessage('That choice is not valid.')]),
  async (req, res) => sendSuccess(res, await selfEnrollment.selfEnroll(req.params.token, req.body, req), { status: 201 }),
);

// A student's own grading sheet, opened from the private link their instructor shared.
router.get('/grades/:token', validate([param('token').isString().isLength({ min: 16, max: 64 }).withMessage('This link is not valid.')]), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, await gradeShare.getSharedSheet(req.params.token));
});

export default router;
