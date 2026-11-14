import { Alerter } from "./alerts.js";
import { defaultSleep, resilient } from "./backoff.js";
import { assertNetworkAllowed, loadConfig } from "./config.js";
import { dryRun } from "./dry-run.js";
import { newKeeper, runLoop } from "./keeper.js";
import { LaunchLock } from "./lock.js";
import { StuckTracker } from "./monitor.js";
import { nearSigner, nearViews } from "./near-chain.js";
import type { Chain, LogFn } from "./types.js";

const log: LogFn = (level, event, fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));

async function main(): Promise<void> {
  const cfg = loadConfig(process.env, process.argv.slice(2));
  assertNetworkAllowed(cfg);
  const views = nearViews(cfg);
  const raw: Chain = cfg.dryRun ? dryRun(views, log) : { ...views, ...(await nearSigner(cfg)) };
  const now = Date.now;
  const chain = resilient(raw, {
    minIntervalMs: cfg.minCallIntervalMs, maxRetries: cfg.maxRetries, baseDelayMs: 1_000, maxDelayMs: 60_000, sleep: defaultSleep, now,
    onRetry: (attempt, delayMs, method) => log("warn", "rpc_429_backoff", { attempt, delay_ms: delayMs, method }),
  });
  const alerts = new Alerter(log, { webhookUrl: cfg.webhookUrl, repeatMs: cfg.alertRepeatMs, now });
  const ctx = { chain, cfg, log, alerts, now, quiet: new Set<string>(), finished: new Set<string>() };
  const keeper = newKeeper(ctx, new LaunchLock({ dir: cfg.lockDir, staleMs: 600_000, now }), new StuckTracker(now, cfg.stuckAfterMs));
  let stopping = false;
  let wake: () => void = () => undefined;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; wake(); });
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });
  log("info", "start", { core: cfg.core, account: cfg.accountId, rpc: cfg.rpcUrl, dry_run: cfg.dryRun, once: cfg.once });
  await runLoop(keeper, { once: cfg.once, stop: () => stopping, sleep });
}

main().catch((e) => { log("error", "fatal", { error: String(e instanceof Error ? e.message : e) }); process.exit(1); });
