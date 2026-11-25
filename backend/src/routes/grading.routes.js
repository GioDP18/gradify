import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validate.js';
import * as grading from '../services/grading/grading.service.js';
import { sendSuccess } from '../utils/response.js';
import { exportClassSheet, exportStudentReport } from '../services/gradeExport.service.js';
import * as gradeShare from '../services/gradeShare.service.js';
import { studentEmailLimiter } from '../middleware/rateLimit.js';

const router = Router();

const classIdQuery = query('classId').isMongoId().withMessage('Choose a class.');
const periodParam = param('period').isIn(['midterm', 'finals', 'overall', 'MIDTERM', 'FINALS', 'OVERALL']).withMessage('Choose Midterm, Finals, or Final Grade.');

// Manual recalculation of a class, or of one of its students when studentId is given.
router.post(
  '/recalculate',
  validate([body('classId').isMongoId().withMessage('Choose a class.'), body('studentId').optional().isMongoId().withMessage('Choose a student.')]),
  async (req, res) => sendSuccess(res, await grading.requestRecalculation(req.user.id, req.body.classId, req, { studentId: req.body.studentId })),
);

// Sharing one student's grading sheet with that student: a private link, optionally time-limited.
const studentIdParam = param('studentId').isMongoId().withMessage('Choose a student.');
const classIdBody = body('classId').isMongoId().withMessage('Choose a class.');
const studentIdsBody = body('studentIds').isArray({ min: 1, max: gradeShare.MAX_BULK_STUDENTS }).withMessage('Select at least one student.');
const eachStudentId = body('studentIds.*').isMongoId().withMessage('Choose a student.');
const durationBody = body('durationHours').optional({ values: 'null' }).isInt({ min: 1, max: gradeShare.MAX_DURATION_HOURS }).withMessage('Choose how long the student can view it.');
const scopeBody = body('scope').optional().isIn(gradeShare.SHARE_SCOPES).withMessage('Choose what the student can see.');
// Several students at once (selected on the class grading sheet).
router.post(
  '/share/bulk',
  studentEmailLimiter,
  validate([classIdBody, studentIdsBody, eachStudentId, durationBody, scopeBody, body('email').optional().isBoolean({ strict: true }).withMessage('That choice is not valid.')]),
  async (req, res) => sendSuccess(res, await gradeShare.setShareMany(req.user.id, req.body.classId, req.body.studentIds, { durationHours: req.body.durationHours ?? null, scope: req.body.scope, email: req.body.email === true }, req)),
);
router.post('/share/bulk/stop', validate([classIdBody, studentIdsBody, eachStudentId]), async (req, res) =>
  sendSuccess(res, await gradeShare.stopShareMany(req.user.id, req.body.classId, req.body.studentIds, req)),
);
router.get('/share/:studentId', validate([studentIdParam, classIdQuery]), async (req, res) =>
  sendSuccess(res, await gradeShare.getShare(req.user.id, req.validatedQuery.classId, req.params.studentId)),
);
router.put(
  '/share/:studentId',
  validate([studentIdParam, classIdBody, durationBody, scopeBody]),
  async (req, res) => sendSuccess(res, await gradeShare.setShare(req.user.id, req.body.classId, req.params.studentId, req.body.durationHours ?? null, req, { scope: req.body.scope })),
);
router.delete('/share/:studentId', validate([studentIdParam, classIdQuery]), async (req, res) =>
  sendSuccess(res, await gradeShare.stopShare(req.user.id, req.validatedQuery.classId, req.params.studentId, req)),
);
router.post('/share/:studentId/email', studentEmailLimiter, validate([studentIdParam, classIdBody]), async (req, res) =>
  sendSuccess(res, await gradeShare.emailShare(req.user.id, req.body.classId, req.params.studentId, req)),
);

// A student's grades across all of the instructor's classes.
router.get('/student/:studentId', validate([param('studentId').isMongoId()]), async (req, res) =>
  sendSuccess(res, await grading.getStudentGradesAcrossClasses(req.user.id, req.params.studentId)),
);

// Exports (CSV / Excel) — built from the engine's persisted results only.
const formatQuery = query('format').optional().isIn(['csv', 'xlsx']).withMessage('Choose CSV or Excel.');
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
