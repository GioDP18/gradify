import { apiClient } from './apiClient';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));

/** API functions for one assessment type (base = '/quizzes' | '/activities' | '/examinations'). */
export function listAssessments(base, params) {
  return apiClient.get(base, { params: clean(params) }).then((r) => r.data.data);
}

export function createAssessment(base, data) {
  return apiClient.post(base, data).then((r) => r.data.data);
}

export function updateAssessment(base, id, data) {
  return apiClient.put(`${base}/${id}`, data).then((r) => r.data.data);
}

export function deleteAssessment(base, id) {
  return apiClient.delete(`${base}/${id}`).then(() => undefined);
}

export function getScoreSheet(base, id) {
  return apiClient.get(`${base}/${id}/scores`).then((r) => r.data.data);
}

export function saveScores(base, id, { revision, scores }) {
  return apiClient.put(`${base}/${id}/scores`, { revision, scores }).then((r) => r.data.data);
}
