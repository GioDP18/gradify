import * as enrollmentService from '../services/enrollment.service.js';
import { sendSuccess } from '../utils/response.js';

export async function roster(req, res) {
  return sendSuccess(res, await enrollmentService.listClassRoster(req.user.id, req.params.id));
}

export async function enroll(req, res) {
  return sendSuccess(res, await enrollmentService.enrollStudents(req.user.id, req.params.id, req.body.studentIds, req));
}

export async function setStatus(req, res) {
  const enrollment = await enrollmentService.setEnrollmentStatus(req.user.id, req.params.id, req.params.studentId, req.body, req);
  return sendSuccess(res, { status: enrollment.status, droppedAt: enrollment.droppedAt, dropReason: enrollment.dropReason });
}

export async function remove(req, res) {
  await enrollmentService.removeEnrollment(req.user.id, req.params.id, req.params.studentId, req);
  return res.status(204).end();
}
