import { useState, useEffect, useCallback } from 'react';
import { socketManager } from '@/api/socket';

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    socketManager.connect();

    const checkConnection = setInterval(() => {
      setIsConnected(socketManager.isConnected);
    }, 1000);

    return () => {
      clearInterval(checkConnection);
    };
  }, []);

  const subscribe = useCallback((event: string, callback: (data: unknown) => void) => {
    const unsub = socketManager.subscribe(event, (data) => {
      setLastUpdate(new Date());
      callback(data);
    });
    return unsub;
  }, []);

  return { isConnected, lastUpdate, subscribe };
}
