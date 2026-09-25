import { useCallback, useEffect, useRef, useState } from 'react';

/** Fetch now, then every `intervalMs` while the tab is visible. `reload()` refetches immediately. */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, intervalMs);
    return () => clearInterval(t);
  }, deps);

  return { data, error, loading, reload: load };
}
