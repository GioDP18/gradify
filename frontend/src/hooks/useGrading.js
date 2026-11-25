import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as gradingApi from '../services/gradingApi';

export const gradingKeys = {
  all: ['grading'],
  sheet: (period, classId) => ['grading', 'sheet', period, classId],
  student: (period, classId, studentId) => ['grading', 'student', period, classId, studentId],
  studentAll: (studentId) => ['grading', 'student-all', studentId],
  share: (classId, studentId) => ['grading-share', classId, studentId],
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
    // While another period loads, the previous report stays available (isPlaceholderData), so the
    // page can keep what does not change between periods: the student and the class.
    placeholderData: keepPreviousData,
  });
}

export function useStudentGradesAcrossClasses(studentId) {
  return useQuery({ queryKey: gradingKeys.studentAll(studentId), queryFn: () => gradingApi.getStudentGradesAcrossClasses(studentId), enabled: Boolean(studentId), staleTime: 0 });
}

/** Whether (and until when) a student can view their own grading sheet for a class. */
export function useGradeShare(classId, studentId, { enabled = true } = {}) {
  return useQuery({
    queryKey: gradingKeys.share(classId, studentId),
    queryFn: () => gradingApi.getGradeShare(classId, studentId),
    enabled: Boolean(enabled && classId && studentId),
    staleTime: 0,
  });
}

/** Start or re-time the share, stop it, or email the link; each updates the cached state from the reply. */
export function useGradeShareActions(classId, studentId) {
  const queryClient = useQueryClient();
  const store = (result) => {
    queryClient.setQueryData(gradingKeys.share(classId, studentId), result);
    return result;
  };
  return {
    set: (durationHours, scope) => gradingApi.setGradeShare(classId, studentId, durationHours, scope).then(store),
    stop: () => gradingApi.stopGradeShare(classId, studentId).then(store),
    email: () => gradingApi.emailGradeShare(classId, studentId).then(store),
  };
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

/** Recalculates one student's grades in a class (all periods). */
export function useRecalculateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, studentId }) => gradingApi.recalculateStudent(classId, studentId),
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
