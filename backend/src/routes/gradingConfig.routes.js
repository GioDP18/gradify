import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { authorize } from '../middleware/auth.js';
import { requireTrustedOrigin } from '../middleware/originCheck.js';
import { ROLES } from '../models/User.js';
import * as grading from '../services/grading/grading.service.js';
import { sendSuccess } from '../utils/response.js';

/**
 * The shared grading criteria (D21). Instructors and the administrator can read them;
 * only the administrator publishes a new version, which applies to every class.
 */
const router = Router();

router.get('/', async (req, res) => sendSuccess(res, await grading.getConfiguration()));
router.get('/versions', async (req, res) => sendSuccess(res, await grading.getConfigurationVersions()));
router.post(
  '/',
  requireTrustedOrigin,
  authorize(ROLES.ADMIN),
  validate([
    body('periodWeights').optional().isObject().withMessage('The grading criteria are not valid.'),
    body('periods').optional().isObject().withMessage('The grading criteria are not valid.'),
    body('notes').optional({ values: 'null' }).isString().trim().isLength({ max: 500 }).withMessage('Notes must be at most 500 characters'),
  ]),
  async (req, res) => {
    const changes = Object.fromEntries(['periodWeights', 'periods', 'notes'].filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]]));
    return sendSuccess(res, await grading.updateConfiguration(req.user.id, changes, req), { status: 201 });
  },
);

export default router;
