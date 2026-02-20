import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api';
import type { TaskRecord } from '@/api/types';

export function useHistory(filter = 'All', dateRange = '30d') {
  const [events, setEvents] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getTasks({
        filter: filter === 'All' ? undefined : filter,
        dateRange,
      });
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [filter, dateRange]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { events, loading, error, refetch };
}
