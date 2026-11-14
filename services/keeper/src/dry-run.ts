import type { CallResult, Chain, LogFn } from "./types.js";

/** Views pass through; calls are only logged. Nothing is signed or sent. */
export function dryRun(inner: Pick<Chain, "view">, log: LogFn): Chain {
  return {
    view: (method, args) => inner.view(method, args),
    call: async (method, args, gasTgas): Promise<CallResult> => {
      log("info", "dry_run_would_send", { method, args, gas_tgas: gasTgas });
      return { ok: true, dry: true };
    },
  };
}
