import { Router } from 'express';
import * as controller from '../controllers/attendance.controller.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.validators.js';
import {
  listSessionRules, createSessionRules, updateSessionRules, updateRecordsRules, summaryRules,
} from '../validators/attendance.validators.js';

const router = Router();

router.get('/', validate(listSessionRules), controller.listSessions);
router.get('/summary', validate(summaryRules), controller.summary);
router.post('/sessions', validate(createSessionRules), controller.createSession);
router.put('/sessions/:id', validate([idParam(), ...updateSessionRules]), controller.updateSession);
router.delete('/sessions/:id', validate([idParam()]), controller.deleteSession);
router.get('/sessions/:id/records', validate([idParam()]), controller.getRecords);
router.put('/sessions/:id/records', validate([idParam(), ...updateRecordsRules]), controller.updateRecords);
router.get('/:id', validate([idParam()]), controller.getSession);

export default router;
