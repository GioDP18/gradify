import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as attendanceApi from '../services/attendanceApi';

export const attendanceKeys = {
  all: ['attendance'],
  sessions: (params) => ['attendance', 'sessions', params],
  records: (id) => ['attendance', 'records', id],
  summary: (params) => ['attendance', 'summary', params],
};

export function useAttendanceSessions(params, { enabled = true } = {}) {
  return useQuery({
    queryKey: attendanceKeys.sessions(params),
    queryFn: () => attendanceApi.listSessions(params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSessionRecords(id) {
  return useQuery({
    queryKey: attendanceKeys.records(id),
    queryFn: () => attendanceApi.getSessionRecords(id),
    enabled: Boolean(id),
    // Never refetch behind the instructor's back while they are editing statuses.
    refetchOnWindowFocus: false,
  });
}

export function useAttendanceSummary(params, { enabled = true } = {}) {
  return useQuery({ queryKey: attendanceKeys.summary(params), queryFn: () => attendanceApi.getAttendanceSummary(params), enabled });
}

function useAttendanceMutation(mutationFn, { onSuccess } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      onSuccess?.(queryClient, data, variables);
      return queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
    },
  });
}

export const useCreateSession = () => useAttendanceMutation((data) => attendanceApi.createSession(data));
export const useUpdateSession = () => useAttendanceMutation(({ id, data }) => attendanceApi.updateSession(id, data));
export const useDeleteSession = () => useAttendanceMutation((id) => attendanceApi.deleteSession(id));
export const useSaveSessionRecords = () =>
  useAttendanceMutation(({ id, revision, records }) => attendanceApi.saveSessionRecords(id, { revision, records }), {
    // Put the saved state straight into the cache so the page never flashes stale data.
    onSuccess: (queryClient, data, { id }) => queryClient.setQueryData(attendanceKeys.records(id), { session: data.session, records: data.records }),
  });
