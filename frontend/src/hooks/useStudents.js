import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as studentsApi from '../services/studentsApi';

export const studentKeys = {
  all: ['students'],
  list: (params) => ['students', 'list', params],
  facets: () => ['students', 'facets'],
  detail: (id) => ['students', 'detail', id],
};

export function useStudentList(params) {
  return useQuery({
    queryKey: studentKeys.list(params),
    queryFn: () => studentsApi.listStudents(params),
    placeholderData: keepPreviousData, // keep the table steady while paging/filtering
  });
}

export function useStudentFacets() {
  return useQuery({ queryKey: studentKeys.facets(), queryFn: studentsApi.getStudentFacets, staleTime: 60_000 });
}

export function useStudent(id) {
  return useQuery({ queryKey: studentKeys.detail(id), queryFn: () => studentsApi.getStudent(id), enabled: Boolean(id) });
}

/** Any roster change can affect lists, facets, details, and class rosters. */
function useStudentMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studentKeys.all }),
  });
}

export const useCreateStudent = () => useStudentMutation(({ data, classId }) => studentsApi.createStudent(data, { classId }));
export const useUpdateStudent = () => useStudentMutation(({ id, data }) => studentsApi.updateStudent(id, data));
export const useArchiveStudent = () => useStudentMutation((id) => studentsApi.archiveStudent(id));
export const useRestoreStudent = () => useStudentMutation((id) => studentsApi.restoreStudent(id));
export const useEnrollStudents = () => useStudentMutation(({ classId, studentIds }) => studentsApi.enrollStudents(classId, studentIds));
export const useSetEnrollmentStatus = () =>
  useStudentMutation(({ classId, studentId, status, reason }) => studentsApi.setEnrollmentStatus(classId, studentId, { status, reason }));
export const useRemoveEnrollment = () => useStudentMutation(({ classId, studentId }) => studentsApi.removeEnrollment(classId, studentId));
export const useImportStudents = () => useStudentMutation(({ file, options }) => studentsApi.importStudents(file, options));
