import type { CallResult, Chain } from "./types.js";

export interface BackoffOptions {
  /** Minimum gap between two RPC requests (rate limit). */
  minIntervalMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onRetry?: (attempt: number, delayMs: number, method: string) => void;
}

export const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True for an HTTP 429 or a provider's rate-limit wording, wherever the library hid it. */
export function isRateLimited(e: unknown): boolean {
  const o = (e ?? {}) as { status?: number; statusCode?: number; message?: unknown; cause?: unknown };
  if (o.status === 429 || o.statusCode === 429) return true;
  if (/\b429\b|too many requests|rate.?limit/i.test(String(o.message ?? e))) return true;
  return o.cause !== undefined && o.cause !== e && isRateLimited(o.cause);
}

/** Wraps a Chain: serialises requests with a minimum interval and retries rate-limited ones with exponential backoff.
 *  Retrying a call is safe: every keeper method is idempotent against chain state. */
export function resilient(inner: Chain, o: BackoffOptions): Chain {
  let last = Number.NEGATIVE_INFINITY;
  let queue: Promise<unknown> = Promise.resolve();
  const paced = async <T>(method: string, run: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + o.minIntervalMs - o.now();
      if (wait > 0) await o.sleep(wait);
      last = o.now();
      try {
        return await run();
      } catch (e) {
        if (!isRateLimited(e) || attempt >= o.maxRetries) throw e;
        const delay = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** attempt);
        o.onRetry?.(attempt + 1, delay, method);
        await o.sleep(delay);
      }
    }
  };
  const serial = <T>(method: string, run: () => Promise<T>): Promise<T> => {
    const next = queue.then(() => paced(method, run), () => paced(method, run));
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    view: <T>(method: string, args: Record<string, unknown>) => serial(method, () => inner.view<T>(method, args)),
    call: (method: string, args: Record<string, unknown>, gas: number): Promise<CallResult> => serial(method, () => inner.call(method, args, gas)),
  };
}
