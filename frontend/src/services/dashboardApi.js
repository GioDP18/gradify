import { apiClient } from './apiClient';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));
const get = (path, params) => apiClient.get(`/dashboard/${path}`, { params: clean(params) }).then((r) => r.data.data);

export const getOverview = (params) => get('overview', params);
export const getAttendanceDashboard = (params) => get('attendance', params);
export const getPerformanceDashboard = (params) => get('performance', params);
export const getRecentActivity = (params) => get('activity', params);
