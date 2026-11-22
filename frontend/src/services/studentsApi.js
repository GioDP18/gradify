import { apiClient } from './apiClient';
import { filenameFromDisposition, saveBlob } from '../utils/download';

/** Drops empty values so they are not sent as filters. */
function cleanParams(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false));
}

export async function listStudents(params) {
  const response = await apiClient.get('/students', { params: cleanParams(params) });
  return { items: response.data.data, meta: response.data.meta };
}

export async function getStudentFacets() {
  return (await apiClient.get('/students/facets')).data.data;
}

export async function getStudent(id) {
  return (await apiClient.get(`/students/${id}`)).data.data;
}

export async function createStudent(data, { classId } = {}) {
  return (await apiClient.post('/students', data, { params: cleanParams({ classId }) })).data.data;
}

export async function updateStudent(id, data) {
  return (await apiClient.put(`/students/${id}`, data)).data.data;
}

export async function archiveStudent(id) {
  return (await apiClient.delete(`/students/${id}`)).data.data;
}

export async function restoreStudent(id) {
  return (await apiClient.post(`/students/${id}/restore`)).data.data;
}

/** Downloads the student list (current filters) as CSV. */
export async function exportStudents(params) {
  const response = await apiClient.get('/students/export', { params: cleanParams(params), responseType: 'blob' });
  saveBlob(response.data, filenameFromDisposition(response.headers['content-disposition'], 'evsu-students.csv'));
}

export async function importStudents(file, { classId, dryRun, skipInvalid } = {}) {
  const form = new FormData();
  form.append('file', file);
  const response = await apiClient.post('/students/import', form, {
    params: cleanParams({ classId, dryRun, skipInvalid }),
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return response.data.data;
}

export async function enrollStudents(classId, studentIds) {
  return (await apiClient.post(`/classes/${classId}/enrollments`, { studentIds })).data.data;
}

export async function setEnrollmentStatus(classId, studentId, { status, reason }) {
  return (await apiClient.put(`/classes/${classId}/enrollments/${studentId}`, { status, reason: reason || undefined })).data.data;
}

export async function removeEnrollment(classId, studentId) {
  await apiClient.delete(`/classes/${classId}/enrollments/${studentId}`);
}
