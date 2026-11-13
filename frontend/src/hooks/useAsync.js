import { useCallback, useEffect, useState } from 'react';

/**
 * Run an async function when `deps` change and track { data, error, loading }.
 *   const { data, error, loading, reload } = useAsync((signal) => api.getProvider(id, signal), [id]);
 * - an older request that finishes late is ignored (and aborted) when deps change
 * - reload() runs the same request again
 */
export default function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: null, loading: true });
    fn(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ data: null, error, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
