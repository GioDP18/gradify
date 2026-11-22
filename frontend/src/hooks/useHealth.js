import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../services/healthApi';

export const healthKeys = {
  all: ['health'],
};

export function useHealth() {
  return useQuery({
    queryKey: healthKeys.all,
    queryFn: fetchHealth,
    retry: false,
    refetchInterval: 30000,
  });
}
