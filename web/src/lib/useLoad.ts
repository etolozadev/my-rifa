import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Carga un recurso, lo refresca cada `every` ms y al volver a la pestaña. */
export function useLoad<T>(fetcher: () => Promise<T>, every = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const reload = useCallback(async () => {
    try {
      setData(await fetchRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Error inesperado'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, every);
    const onFocus = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload, every]);

  return { data, error, loading, reload };
}
