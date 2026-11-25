import { apiClient } from './apiClient';
import { filenameFromDisposition, saveBlob } from '../utils/download';

const data = (r) => r.data.data;

export const getClassGrades = (period, classId) => apiClient.get(`/grading/${period}`, { params: { classId } }).then(data);
export const getStudentGrade = (period, classId, studentId) => apiClient.get(`/grading/${period}/student/${studentId}`, { params: { classId } }).then(data);
export const getStudentGradesAcrossClasses = (studentId) => apiClient.get(`/grading/student/${studentId}`).then(data);
export const recalculateClass = (classId) => apiClient.post('/grading/recalculate', { classId }).then(data);
export const recalculateStudent = (classId, studentId) => apiClient.post('/grading/recalculate', { classId, studentId }).then(data);
export const getConfiguration = () => apiClient.get('/grading/configuration').then(data);
export const getConfigurationVersions = () => apiClient.get('/grading/configuration/versions').then(data);
export const saveConfiguration = (changes) => apiClient.post('/grading/configuration', changes, { timeout: 120000 }).then(data);

// Sharing one student's grading sheet with that student (private link, optional time limit).
export const getGradeShare = (classId, studentId) => apiClient.get(`/grading/share/${studentId}`, { params: { classId } }).then(data);
export const setGradeShare = (classId, studentId, durationHours, scope) => apiClient.put(`/grading/share/${studentId}`, { classId, durationHours, scope }).then(data);
export const stopGradeShare = (classId, studentId) => apiClient.delete(`/grading/share/${studentId}`, { params: { classId } }).then(data);
// The same for several students at once: { shared, emailed, noEmail: [names], emailFailed: [names], … }.
export const setGradeShareMany = (classId, studentIds, { durationHours, scope, email }) =>
  apiClient.post('/grading/share/bulk', { classId, studentIds, durationHours, scope, email }, { timeout: 120000 }).then(data);
export const stopGradeShareMany = (classId, studentIds) => apiClient.post('/grading/share/bulk/stop', { classId, studentIds }).then(data);
export const emailGradeShare = (classId, studentId) => apiClient.post(`/grading/share/${studentId}/email`, { classId }, { timeout: 45000 }).then(data);

async function download(url, params, fallback) {
  const response = await apiClient.get(url, { params, responseType: 'blob' });
  saveBlob(response.data, filenameFromDisposition(response.headers['content-disposition'], fallback));
}

export const exportClassGrades = (period, classId, format) => download(`/grading/${period}/export`, { classId, format }, `evsu-grades.${format}`);
export const exportStudentReport = (period, classId, studentId, format) =>
  download(`/grading/${period}/student/${studentId}/export`, { classId, format }, `evsu-grade-report.${format}`);
