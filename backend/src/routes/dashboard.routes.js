import { Router } from 'express';
import { query } from 'express-validator';
import { validate } from '../middleware/validate.js';
import * as dashboard from '../services/dashboard.service.js';
import { sendSuccess } from '../utils/response.js';
import { parseDateOnly } from '../utils/dates.js';

const router = Router();

// Optional: without a class the dashboard covers all of the instructor's active classes.
const classId = query('classId').optional().isMongoId().withMessage('Choose a class.');
const period = query('period').optional().isIn(['MIDTERM', 'FINALS']).withMessage('Choose Midterm or Finals.');
const date = (name) => query(name).optional().custom((v) => parseDateOnly(v) !== null).withMessage('Enter a valid date.');

router.get('/overview', validate([classId, period, date('from'), date('to')]), async (req, res) =>
  sendSuccess(res, await dashboard.getOverview(req.user.id, req.validatedQuery)),
);
router.get('/attendance', validate([classId, date('from'), date('to')]), async (req, res) =>
  sendSuccess(res, await dashboard.getAttendanceDashboard(req.user.id, req.validatedQuery)),
);
router.get('/performance', validate([classId, period]), async (req, res) =>
  sendSuccess(res, await dashboard.getPerformanceDashboard(req.user.id, req.validatedQuery)),
);
router.get('/activity', validate([classId, query('limit').optional().isInt({ min: 1, max: 50 }).toInt()]), async (req, res) =>
  sendSuccess(res, await dashboard.getRecentActivity(req.user.id, req.validatedQuery)),
);

export default router;
