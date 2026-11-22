import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validate.js';
import * as grading from '../services/grading/grading.service.js';
import { sendSuccess } from '../utils/response.js';
import { exportClassSheet, exportStudentReport } from '../services/gradeExport.service.js';

const router = Router();

const classIdQuery = query('classId').isMongoId().withMessage('classId is required');
const periodParam = param('period').isIn(['midterm', 'finals', 'overall', 'MIDTERM', 'FINALS', 'OVERALL']).withMessage('period must be midterm, finals, or overall');

// Manual recalculation of a class (the backend decides the scope).
router.post('/recalculate', validate([body('classId').isMongoId().withMessage('classId is required')]), async (req, res) =>
  sendSuccess(res, await grading.requestRecalculation(req.user.id, req.body.classId, req)),
);

// A student's grades across all of the instructor's classes.
router.get('/student/:studentId', validate([param('studentId').isMongoId()]), async (req, res) =>
  sendSuccess(res, await grading.getStudentGradesAcrossClasses(req.user.id, req.params.studentId)),
);

// Exports (CSV / Excel) — built from the engine's persisted results only.
const formatQuery = query('format').optional().isIn(['csv', 'xlsx']).withMessage('format must be csv or xlsx');
function sendFile(res, { filename, contentType, body }) {
  res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  return res.send(Buffer.isBuffer(body) ? body : Buffer.from(body));
}
router.get('/:period/export', validate([periodParam, classIdQuery, formatQuery]), async (req, res) =>
  sendFile(res, await exportClassSheet(req.user.id, req.validatedQuery.classId, req.params.period, req.validatedQuery.format ?? 'csv')),
);
router.get('/:period/student/:studentId/export', validate([periodParam, param('studentId').isMongoId(), classIdQuery, formatQuery]), async (req, res) =>
  sendFile(res, await exportStudentReport(req.user.id, req.validatedQuery.classId, req.params.period, req.params.studentId, req.validatedQuery.format ?? 'csv')),
);

router.get('/:period/summary', validate([periodParam, classIdQuery]), async (req, res) =>
  sendSuccess(res, await grading.getClassSummary(req.user.id, req.validatedQuery.classId, req.params.period)),
);
router.get('/:period/student/:studentId', validate([periodParam, param('studentId').isMongoId(), classIdQuery]), async (req, res) =>
  sendSuccess(res, await grading.getStudentGrade(req.user.id, req.validatedQuery.classId, req.params.period, req.params.studentId)),
);
router.get('/:period', validate([periodParam, classIdQuery]), async (req, res) =>
  sendSuccess(res, await grading.getClassGrades(req.user.id, req.validatedQuery.classId, req.params.period)),
);

export default router;
