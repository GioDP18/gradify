import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as gradingApi from '../services/gradingApi';

export const gradingKeys = {
  all: ['grading'],
  sheet: (period, classId) => ['grading', 'sheet', period, classId],
  student: (period, classId, studentId) => ['grading', 'student', period, classId, studentId],
  studentAll: (studentId) => ['grading', 'student-all', studentId],
  config: () => ['grading', 'config'],
  versions: () => ['grading', 'versions'],
};

/** Grades are derived data: always ask the engine (it recalculates anything stale first). */
export function useClassGrades(period, classId) {
  return useQuery({
    queryKey: gradingKeys.sheet(period, classId),
    queryFn: () => gradingApi.getClassGrades(period, classId),
    enabled: Boolean(classId),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useStudentGrade(period, classId, studentId) {
  return useQuery({
    queryKey: gradingKeys.student(period, classId, studentId),
    queryFn: () => gradingApi.getStudentGrade(period, classId, studentId),
    enabled: Boolean(classId && studentId),
    staleTime: 0,
  });
}

export function useStudentGradesAcrossClasses(studentId) {
  return useQuery({ queryKey: gradingKeys.studentAll(studentId), queryFn: () => gradingApi.getStudentGradesAcrossClasses(studentId), enabled: Boolean(studentId), staleTime: 0 });
}

export function useGradingConfiguration() {
  return useQuery({ queryKey: gradingKeys.config(), queryFn: gradingApi.getConfiguration });
}

export function useGradingConfigurationVersions() {
  return useQuery({ queryKey: gradingKeys.versions(), queryFn: gradingApi.getConfigurationVersions });
}

export function useRecalculateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classId) => gradingApi.recalculateClass(classId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gradingKeys.all }),
  });
}

export function useSaveConfiguration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes) => gradingApi.saveConfiguration(changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gradingKeys.all }),
  });
}
