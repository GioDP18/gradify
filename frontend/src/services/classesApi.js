import { apiClient } from './apiClient';

export async function listClasses(params = {}) {
  const response = await apiClient.get('/classes', { params });
  return response.data.data;
}

export async function createClass(data) {
  const response = await apiClient.post('/classes', data);
  return response.data.data;
}

export async function updateClass(id, data) {
  const response = await apiClient.put(`/classes/${id}`, data);
  return response.data.data;
}

export async function archiveClass(id) {
  const response = await apiClient.delete(`/classes/${id}`);
  return response.data.data;
}

export async function restoreClass(id) {
  const response = await apiClient.post(`/classes/${id}/restore`);
  return response.data.data;
}

/** QR self-enrollment on/off (turning it on the first time creates the private link). */
export async function setSelfEnrollment(id, open) {
  const response = await apiClient.put(`/classes/${id}/self-enrollment`, { open });
  return response.data.data;
}

/** A new private link: QR codes and links shared earlier stop working. */
export async function newSelfEnrollmentLink(id) {
  const response = await apiClient.post(`/classes/${id}/self-enrollment/link`);
  return response.data.data;
}
