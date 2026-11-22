import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../models/User.js';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import classRoutes from './class.routes.js';
import studentRoutes from './student.routes.js';
import attendanceRoutes from './attendance.routes.js';
import { createAssessmentRouter } from './assessment.routes.js';
import { ASSESSMENT_TYPES } from '../models/assessments.js';
// Importing the grading routes also registers the grading engine's source-change handler.
import gradingRoutes from './grading.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import internalRoutes from './internal.routes.js';
import gradingConfigRoutes from './gradingConfig.routes.js';
import adminRoutes from './admin.routes.js';
import publicRoutes from './public.routes.js';

/** Mounts every API module under /api. Feature routes are added here phase by phase. */
const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/internal', internalRoutes);
router.use('/public', publicRoutes); // no sign-in: QR self-enrollment // cron-secret protected maintenance (no user access)

// Shared grading criteria: instructors read them, the administrator edits them (D21). Mounted
// before /grading so this path is not caught by the instructor-only grading router.
router.use('/grading/configuration', authenticate, authorize(ROLES.INSTRUCTOR, ROLES.ADMIN), gradingConfigRoutes);
// Administrator: instructor accounts (D23).
router.use('/admin', authenticate, authorize(ROLES.ADMIN), adminRoutes);

// Everything below is instructor-only.
const instructorOnly = [authenticate, authorize(ROLES.INSTRUCTOR)];
router.use('/classes', instructorOnly, classRoutes);
router.use('/students', instructorOnly, studentRoutes);
router.use('/attendance', instructorOnly, attendanceRoutes);
router.use('/quizzes', instructorOnly, createAssessmentRouter(ASSESSMENT_TYPES.quizzes));
router.use('/activities', instructorOnly, createAssessmentRouter(ASSESSMENT_TYPES.activities));
router.use('/examinations', instructorOnly, createAssessmentRouter(ASSESSMENT_TYPES.examinations));
router.use('/grading', instructorOnly, gradingRoutes);
router.use('/dashboard', instructorOnly, dashboardRoutes);

export default router;
