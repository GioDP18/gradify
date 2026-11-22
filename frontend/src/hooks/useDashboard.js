import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as dashboardApi from '../services/dashboardApi';

/**
 * Dashboard data is derived from attendance, scores, and the grading engine. It is refetched
 * whenever the dashboard opens (staleTime 0) so it always reflects the latest saved changes.
 * Without a classId the backend summarizes all active classes; pass enabled: false to skip.
 */
const options = (key, fn, { enabled = true, ...params }) => ({
  queryKey: ['dashboard', key, params],
  queryFn: () => fn(params),
  enabled,
  staleTime: 0,
  placeholderData: keepPreviousData,
});

export const useDashboardOverview = (params) => useQuery(options('overview', dashboardApi.getOverview, params));
export const useDashboardAttendance = (params) => useQuery(options('attendance', dashboardApi.getAttendanceDashboard, params));
export const useDashboardPerformance = (params) => useQuery(options('performance', dashboardApi.getPerformanceDashboard, params));
export const useRecentActivity = (params) => useQuery(options('activity', dashboardApi.getRecentActivity, params));
