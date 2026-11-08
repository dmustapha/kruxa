'use client';
// One hook for every read: loading / ok / error, abortable, optional polling. `key` changes re-run it. A null loader means "not enabled".
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './client';

export type ApiState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: ApiError };

export function useApi<T>(load: ((signal: AbortSignal) => Promise<T>) | null, key: string, pollMs = 0): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>(load ? { status: 'loading' } : { status: 'idle' });
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const fn = loadRef.current;
    if (!fn) { setState({ status: 'idle' }); return; }
    const ctl = new AbortController();
    let first = true;
    const run = () => {
      if (first) setState((s) => (s.status === 'ok' ? s : { status: 'loading' }));
      fn(ctl.signal).then(
        (data) => { if (!ctl.signal.aborted) setState({ status: 'ok', data }); },
        (e: unknown) => {
          if (ctl.signal.aborted) return;
          setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError('unreachable', e instanceof Error ? e.message : 'Request failed.') });
        },
      );
      first = false;
    };
    run();
    const timer = pollMs > 0 ? setInterval(run, pollMs) : null;
    return () => { ctl.abort(); if (timer) clearInterval(timer); };
  }, [key, pollMs, tick]);

  return { ...state, reload };
}
