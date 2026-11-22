import * as classService from '../services/class.service.js';
import { sendSuccess } from '../utils/response.js';

export async function list(req, res) {
  return sendSuccess(res, await classService.listClasses(req.user.id, req.validatedQuery));
}

export async function get(req, res) {
  return sendSuccess(res, await classService.getClass(req.user.id, req.params.id));
}

export async function create(req, res) {
  return sendSuccess(res, await classService.createClass(req.user.id, req.body, req), { status: 201 });
}

export async function update(req, res) {
  return sendSuccess(res, await classService.updateClass(req.user.id, req.params.id, req.body, req));
}

export async function archive(req, res) {
  return sendSuccess(res, await classService.setArchived(req.user.id, req.params.id, true, req));
}

export async function restore(req, res) {
  return sendSuccess(res, await classService.setArchived(req.user.id, req.params.id, false, req));
}
