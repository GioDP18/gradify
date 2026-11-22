import { sendSuccess } from '../utils/response.js';
import * as classService from '../services/class.service.js';
import { body } from 'express-validator';
import { Router } from 'express';
import * as controller from '../controllers/class.controller.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.validators.js';
import { createClassRules, updateClassRules, listClassRules } from '../validators/class.validators.js';
import { enrollRules, enrollmentStatusRules } from '../validators/student.validators.js';
import * as enrollment from '../controllers/enrollment.controller.js';

const router = Router();

router.get('/', validate(listClassRules), controller.list);
router.post('/', validate(createClassRules), controller.create);
router.get('/:id', validate([idParam()]), controller.get);
router.put('/:id', validate([idParam(), ...updateClassRules]), controller.update);
// DELETE archives the class; academic records are never destroyed.
router.delete('/:id', validate([idParam()]), controller.archive);
router.post('/:id/restore', validate([idParam()]), controller.restore);
// QR self-enrollment: on/off, and a new private link (old QR codes stop working).
router.put('/:id/self-enrollment', validate([idParam(), body('open').isBoolean({ strict: true }).withMessage('open must be true or false')]), async (req, res) =>
  sendSuccess(res, await classService.setSelfEnrollment(req.user.id, req.params.id, req.body.open, req)),
);
router.post('/:id/self-enrollment/link', validate([idParam()]), async (req, res) =>
  sendSuccess(res, await classService.regenerateJoinToken(req.user.id, req.params.id, req)),
);

// Enrollments (class roster)
router.get('/:id/enrollments', validate([idParam()]), enrollment.roster);
router.post('/:id/enrollments', validate([idParam(), ...enrollRules]), enrollment.enroll);
router.put('/:id/enrollments/:studentId', validate([idParam(), idParam('studentId'), ...enrollmentStatusRules]), enrollment.setStatus);
router.delete('/:id/enrollments/:studentId', validate([idParam(), idParam('studentId')]), enrollment.remove);

export default router;
