import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { requireTrustedOrigin } from '../middleware/originCheck.js';
import { uploadAvatar } from '../middleware/upload.js';
import { loginLimiter, loginIpLimiter, passwordCheckLimiter, passwordResetRequestLimiter, passwordResetSubmitLimiter } from '../middleware/rateLimit.js';
import { loginRules, updateProfileRules, changePasswordRules, preferencesRules, forgotPasswordRules, resetTokenRules, resetPasswordRules } from '../validators/auth.validators.js';
import * as passwordReset from '../services/passwordReset.service.js';
import { sendSuccess } from '../utils/response.js';

const router = Router();

router.post('/login', requireTrustedOrigin, loginIpLimiter, loginLimiter, validate(loginRules), controller.login);
router.post('/refresh', requireTrustedOrigin, controller.refresh);
router.post('/logout', requireTrustedOrigin, controller.logout);
// Forgot password (no sign-in): ask for a link by email, then choose a new password with it.
// The token is always sent in the request body, never in the address, so it is not written to logs.
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
router.post('/password/forgot', requireTrustedOrigin, passwordResetRequestLimiter, validate(forgotPasswordRules), noStore, async (req, res) =>
  sendSuccess(res, await passwordReset.requestPasswordReset(req.body.email, req)),
);
router.post('/password/reset/check', requireTrustedOrigin, passwordResetSubmitLimiter, validate(resetTokenRules), noStore, async (req, res) =>
  sendSuccess(res, await passwordReset.checkResetToken(req.body.token)),
);
router.post('/password/reset', requireTrustedOrigin, passwordResetSubmitLimiter, validate(resetPasswordRules), noStore, async (req, res) =>
  sendSuccess(res, await passwordReset.resetPassword(req.body.token, req.body.newPassword, req)),
);
// Any authenticated role may ask who it is (the frontend uses this to show the access-restricted page).
router.get('/me', authenticate, controller.me);
// Own account only: there is no way to edit another user here.
router.patch('/me', requireTrustedOrigin, authenticate, passwordCheckLimiter, validate(updateProfileRules), controller.updateProfile);
router.patch('/me/preferences', requireTrustedOrigin, authenticate, validate(preferencesRules), controller.updatePreferences);
router.get('/me/avatar', authenticate, controller.getAvatar);
router.put('/me/avatar', requireTrustedOrigin, authenticate, uploadAvatar, controller.setAvatar);
router.delete('/me/avatar', requireTrustedOrigin, authenticate, controller.removeAvatar);
router.put('/me/password', requireTrustedOrigin, authenticate, passwordCheckLimiter, validate(changePasswordRules), controller.changePassword);

export default router;
