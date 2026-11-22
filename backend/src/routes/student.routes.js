import { Router } from 'express';
import * as controller from '../controllers/student.controller.js';
import { validate } from '../middleware/validate.js';
import { uploadCsv } from '../middleware/upload.js';
import { idParam } from '../validators/common.validators.js';
import { listStudentRules, studentFilterRules, createStudentQueryRules, importRules } from '../validators/student.validators.js';

const router = Router();

/** Keeps the original JSON body for services that apply the shared student rules themselves. */
function keepRawBody(req, res, next) {
  req.rawBody = req.body ?? {};
  next();
}

router.get('/', validate(listStudentRules), controller.list);
router.get('/facets', controller.facets);
router.get('/export', validate(studentFilterRules), controller.exportCsv);
router.post('/import', validate(importRules), uploadCsv, controller.importCsv);
router.post('/', keepRawBody, validate(createStudentQueryRules), controller.create);
router.get('/:id', validate([idParam()]), controller.get);
router.put('/:id', keepRawBody, validate([idParam()]), controller.update);
// DELETE archives (soft-deletes) the student; academic history is never destroyed.
router.delete('/:id', validate([idParam()]), controller.archive);
router.post('/:id/restore', validate([idParam()]), controller.restore);

export default router;
