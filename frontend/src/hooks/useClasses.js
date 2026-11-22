import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as classesApi from '../services/classesApi';

export const classKeys = {
  all: ['classes'],
  list: () => [...classKeys.all, 'list'],
};

/** All of the instructor's classes (active and archived); filtering happens client-side. */
export function useClasses({ enabled = true } = {}) {
  return useQuery({ queryKey: classKeys.list(), queryFn: () => classesApi.listClasses(), enabled });
}

function useClassMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classKeys.all }),
  });
}

export const useCreateClass = () => useClassMutation((data) => classesApi.createClass(data));
export const useUpdateClass = () => useClassMutation(({ id, data }) => classesApi.updateClass(id, data));
export const useArchiveClass = () => useClassMutation((id) => classesApi.archiveClass(id));
export const useRestoreClass = () => useClassMutation((id) => classesApi.restoreClass(id));
