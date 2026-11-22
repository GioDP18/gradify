import { apiClient } from './apiClient';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));

export async function listSessions(params) {
  const response = await apiClient.get('/attendance', { params: clean(params) });
  return { items: response.data.data, meta: response.data.meta };
}

export async function createSession(data) {
  return (await apiClient.post('/attendance/sessions', data)).data.data;
}

export async function updateSession(id, data) {
  return (await apiClient.put(`/attendance/sessions/${id}`, data)).data.data;
}

export async function deleteSession(id) {
  await apiClient.delete(`/attendance/sessions/${id}`);
}

export async function getSessionRecords(id) {
  return (await apiClient.get(`/attendance/sessions/${id}/records`)).data.data;
}

export async function saveSessionRecords(id, { revision, records }) {
  return (await apiClient.put(`/attendance/sessions/${id}/records`, { revision, records })).data.data;
}

export async function getAttendanceSummary(params) {
  return (await apiClient.get('/attendance/summary', { params: clean(params) })).data.data;
}
