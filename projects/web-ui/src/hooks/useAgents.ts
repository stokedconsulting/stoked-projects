import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api';
import type { ActiveSession } from '@/api/types';

export function useAgents(pollInterval = 30000) {
  const [agents, setAgents] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getActiveSessions();
      setAgents(data);
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

  return { agents, loading, error, refetch };
}
