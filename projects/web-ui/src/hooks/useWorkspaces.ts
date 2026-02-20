import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api';
import type { WorkspaceOrchestration } from '@/api/types';

export function useWorkspaces(pollInterval = 60000) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOrchestration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getWorkspaces();
      setWorkspaces(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, pollInterval);
    return () => clearInterval(interval);
  }, [refetch, pollInterval]);

  return { workspaces, loading, error, refetch };
}
