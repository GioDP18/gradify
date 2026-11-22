import * as attendanceService from '../services/attendance.service.js';
import { sendSuccess } from '../utils/response.js';

export async function listSessions(req, res) {
  const { items, meta } = await attendanceService.listSessions(req.user.id, req.validatedQuery);
  return sendSuccess(res, items, { meta });
}

export async function getSession(req, res) {
  return sendSuccess(res, await attendanceService.getSession(req.user.id, req.params.id));
}

export async function createSession(req, res) {
  return sendSuccess(res, await attendanceService.createSession(req.user.id, req.body, req), { status: 201 });
}

export async function updateSession(req, res) {
  return sendSuccess(res, await attendanceService.updateSession(req.user.id, req.params.id, req.body, req));
}

export async function deleteSession(req, res) {
  await attendanceService.deleteSession(req.user.id, req.params.id, req);
  return res.status(204).end();
}

export async function getRecords(req, res) {
  return sendSuccess(res, await attendanceService.getSessionRecords(req.user.id, req.params.id));
}

export async function updateRecords(req, res) {
  return sendSuccess(res, await attendanceService.updateSessionRecords(req.user.id, req.params.id, req.body, req));
}

export async function summary(req, res) {
  return sendSuccess(res, await attendanceService.getSummary(req.user.id, req.validatedQuery));
}
