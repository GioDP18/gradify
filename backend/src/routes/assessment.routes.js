import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.validators.js';
import { createAssessmentRules, updateAssessmentRules, listAssessmentRules, saveScoresRules } from '../validators/assessment.validators.js';
import { createAssessmentService } from '../services/assessment.service.js';
import { sendSuccess } from '../utils/response.js';

/**
 * Router for one assessment type. Mounted at /quizzes, /activities, and /examinations.
 *   GET    /            list (classId, period, status, search) with per-item statistics
 *   GET    /:id         one item with statistics
 *   POST   /            create
 *   PUT    /:id         update (period locked once scores exist)
 *   DELETE /:id         soft delete (scores preserved)
 *   GET    /:id/scores  score sheet
 *   PUT    /:id/scores  save score changes (revision-checked)
 */
export function createAssessmentRouter(type) {
  const service = createAssessmentService(type);
  const router = Router();

  router.get('/', validate(listAssessmentRules), async (req, res) => sendSuccess(res, await service.list(req.user.id, req.validatedQuery)));
  router.post('/', validate(createAssessmentRules), async (req, res) => sendSuccess(res, await service.create(req.user.id, req.body, req), { status: 201 }));
  router.get('/:id', validate([idParam()]), async (req, res) => sendSuccess(res, await service.get(req.user.id, req.params.id)));
  router.put('/:id', validate([idParam(), ...updateAssessmentRules]), async (req, res) => sendSuccess(res, await service.update(req.user.id, req.params.id, req.body, req)));
  router.delete('/:id', validate([idParam()]), async (req, res) => {
    await service.remove(req.user.id, req.params.id, req);
    res.status(204).end();
  });
  router.get('/:id/scores', validate([idParam()]), async (req, res) => sendSuccess(res, await service.getScoreSheet(req.user.id, req.params.id)));
  router.put('/:id/scores', validate([idParam(), ...saveScoresRules]), async (req, res) => sendSuccess(res, await service.saveScores(req.user.id, req.params.id, req.body, req)));

  return router;
}
