import { Router } from 'express';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { requireTrustedOrigin } from '../middleware/originCheck.js';
import * as admin from '../services/admin.service.js';
import { sendSuccess } from '../utils/response.js';
import { passwordFitsBcrypt, PASSWORD_TOO_LONG } from '../utils/password.js';

/** Administrator only (mounted behind authorize(ADMIN)). */
const router = Router();
const id = param('id').isMongoId().withMessage('Account not found');
const password = (field = 'password') => body(field).isString().withMessage('Enter a password').bail().notEmpty().withMessage('Enter a password').custom(passwordFitsBcrypt).withMessage(PASSWORD_TOO_LONG);

router.get('/users', async (req, res) => sendSuccess(res, await admin.listAccounts()));
router.post(
  '/users',
  requireTrustedOrigin,
  validate([
    body('name').isString().withMessage('Name is required').bail().trim().notEmpty().withMessage('Name is required').isLength({ max: 120 }).withMessage('Name must be at most 120 characters'),
    body('email').isString().withMessage('Email is required').bail().trim().toLowerCase().isEmail().withMessage('Enter a valid email address').isLength({ max: 254 }),
    body('username').optional({ values: 'falsy' }).isString().bail().trim().toLowerCase().matches(/^[a-z0-9._-]{3,40}$/).withMessage('Username must be 3–40 characters: letters, numbers, dots, dashes, or underscores'),
    password(),
  ]),
  async (req, res) => sendSuccess(res, await admin.createInstructor(req.user.id, req.body, req), { status: 201 }),
);
router.put(
  '/users/:id/status',
  requireTrustedOrigin,
  validate([id, body('status').isIn(['ACTIVE', 'DISABLED']).withMessage('status must be ACTIVE or DISABLED')]),
  async (req, res) => sendSuccess(res, await admin.setStatus(req.user.id, req.params.id, req.body.status, req)),
);
router.put(
  '/users/:id/password',
  requireTrustedOrigin,
  validate([id, password()]),
  async (req, res) => sendSuccess(res, await admin.resetPassword(req.user.id, req.params.id, req.body.password, req)),
);

export default router;
