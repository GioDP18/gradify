import { body } from 'express-validator';
import { passwordFitsBcrypt, PASSWORD_TOO_LONG } from '../utils/password.js';

export const loginRules = [
  body('identifier')
    .isString().withMessage('Email or username is required')
    .bail()
    .trim()
    .notEmpty().withMessage('Email or username is required')
    .isLength({ max: 254 }).withMessage('Email or username is too long'),
  body('password')
    .isString().withMessage('Password is required')
    .bail()
    .notEmpty().withMessage('Password is required')
    .custom(passwordFitsBcrypt).withMessage(PASSWORD_TOO_LONG),
  body('remember').optional().isBoolean({ strict: true }).withMessage('remember must be true or false'),
];

export const updateProfileRules = [
  body('name').optional().isString().withMessage('Name must be text').bail().trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ max: 120 }).withMessage('Name must be at most 120 characters'),
  body('email').optional().isString().withMessage('Email must be text').bail().trim().toLowerCase()
    .isEmail().withMessage('Enter a valid email address')
    .isLength({ max: 254 }).withMessage('Email is too long'),
  body('username').optional().isString().withMessage('Username must be text').bail().trim().toLowerCase()
    .custom((v) => v === '' || /^[a-z0-9._-]{3,40}$/.test(v))
    .withMessage('Username must be 3–40 characters: letters, numbers, dots, dashes, or underscores'),
  body('currentPassword').optional({ values: 'falsy' }).isString().withMessage('Password must be text').bail()
    .custom(passwordFitsBcrypt).withMessage(PASSWORD_TOO_LONG),
];

export const changePasswordRules = [
  body('currentPassword').isString().withMessage('Enter your current password').bail()
    .notEmpty().withMessage('Enter your current password')
    .custom(passwordFitsBcrypt).withMessage(PASSWORD_TOO_LONG),
  body('newPassword').isString().withMessage('Enter a new password').bail()
    .notEmpty().withMessage('Enter a new password')
    .custom(passwordFitsBcrypt).withMessage(PASSWORD_TOO_LONG),
];

export const preferencesRules = [
  body('workingClass').optional().isBoolean({ strict: true }).withMessage('workingClass must be true or false'),
];
