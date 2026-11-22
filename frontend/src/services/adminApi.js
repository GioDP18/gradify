import { apiClient } from './apiClient';

const data = (r) => r.data.data;

/** Administrator: instructor accounts. */
export const listAccounts = () => apiClient.get('/admin/users').then(data);
export const createInstructor = (account) => apiClient.post('/admin/users', account).then(data);
export const setAccountStatus = (id, status) => apiClient.put(`/admin/users/${id}/status`, { status }).then(data);
export const setAccountPassword = (id, password) => apiClient.put(`/admin/users/${id}/password`, { password }).then(data);
