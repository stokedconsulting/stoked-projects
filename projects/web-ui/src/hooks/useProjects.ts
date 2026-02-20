import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api';
import type { GitHubProject } from '@/api/types';

export function useProjects(owner: string) {
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!owner) return;
    try {
      setError(null);
      const data = await apiClient.getOrganizationProjects(owner);
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { projects, loading, error, refetch };
}
