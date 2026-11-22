import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as api from '../services/assessmentsApi';

export const assessmentKeys = {
  all: (type) => ['assessments', type.key],
  list: (type, params) => ['assessments', type.key, 'list', params],
  sheet: (type, id) => ['assessments', type.key, 'sheet', id],
};

export function useAssessmentList(type, params, { enabled = true } = {}) {
  return useQuery({
    queryKey: assessmentKeys.list(type, params),
    queryFn: () => api.listAssessments(type.api, params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useScoreSheet(type, id) {
  return useQuery({
    queryKey: assessmentKeys.sheet(type, id),
    queryFn: () => api.getScoreSheet(type.api, id),
    enabled: Boolean(id),
    refetchOnWindowFocus: false, // never replace scores the instructor is typing
  });
}

function useAssessmentMutation(type, mutationFn, onSuccess) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      onSuccess?.(queryClient, data, variables);
      return queryClient.invalidateQueries({ queryKey: assessmentKeys.all(type) });
    },
  });
}

export const useCreateAssessment = (type) => useAssessmentMutation(type, (data) => api.createAssessment(type.api, data));
export const useUpdateAssessment = (type) => useAssessmentMutation(type, ({ id, data }) => api.updateAssessment(type.api, id, data));
export const useDeleteAssessment = (type) => useAssessmentMutation(type, (id) => api.deleteAssessment(type.api, id));
export const useSaveScores = (type) =>
  useAssessmentMutation(
    type,
    ({ id, revision, scores }) => api.saveScores(type.api, id, { revision, scores }),
    (queryClient, data, { id }) => queryClient.setQueryData(assessmentKeys.sheet(type, id), { assessment: data.assessment, rows: data.rows }),
  );
