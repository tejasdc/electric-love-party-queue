import { useState, useEffect, useCallback } from 'react';

const REFRESH_INTERVAL = 10000; // 10 seconds

export function useQueue() {
  const [queue, setQueue] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchQueue = useCallback(async () => {
    try {
      const response = await fetch('/api/queue');

      if (!response.ok) {
        throw new Error(`Failed to fetch queue: ${response.status}`);
      }

      const data = await response.json();

      // Handle various response formats
      if (Array.isArray(data)) {
        setQueue(data);
      } else if (data.queue) {
        setQueue(data.queue);
      } else if (data.tracks) {
        setQueue(data.tracks);
      } else {
        setQueue([]);
      }

      setError(null);
    } catch (err) {
      console.error('Error fetching queue:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(fetchQueue, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Add to queue function
  const addToQueue = useCallback(async (uri) => {
    try {
      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uri }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to add to queue: ${response.status}`);
      }

      // Refresh queue after adding
      await fetchQueue();
      return { success: true };
    } catch (err) {
      console.error('Error adding to queue:', err);
      return { success: false, error: err.message };
    }
  }, [fetchQueue]);

  return { queue, isLoading, error, refetch: fetchQueue, addToQueue };
}

export default useQueue;
