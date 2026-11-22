import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { requireTrustedOrigin } from '../middleware/originCheck.js';
import { uploadAvatar } from '../middleware/upload.js';
import { loginLimiter, loginIpLimiter, passwordCheckLimiter } from '../middleware/rateLimit.js';
import { loginRules, updateProfileRules, changePasswordRules, preferencesRules } from '../validators/auth.validators.js';

const router = Router();

router.post('/login', requireTrustedOrigin, loginIpLimiter, loginLimiter, validate(loginRules), controller.login);
router.post('/refresh', requireTrustedOrigin, controller.refresh);
router.post('/logout', requireTrustedOrigin, controller.logout);
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
