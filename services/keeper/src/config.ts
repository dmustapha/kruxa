export const MAINNET_CONFIRMATION = "I_CONFIRMED_BY_DAMI";

export interface KeeperConfig {
  core: string;
  rpcUrl: string;
  accountId: string;
  keyFile?: string;
  keyEnv?: string;
  dryRun: boolean;
  once: boolean;
  intervalMs: number;
  minCallIntervalMs: number;
  maxRetries: number;
  solvencyEveryMs: number;
  stuckAfterMs: number;
  alertRepeatMs: number;
  maxPagesPerCycle: number;
  refundBatch: number;
  webhookUrl?: string;
  lockDir?: string;
  mainnetConfirmation?: string;
}

type Env = Record<string, string | undefined>;

const num = (v: string | undefined, d: number): number => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid number in env: ${v}`);
  return n;
};

const need = (env: Env, k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

/** Dry-run unless --send is given or KEEPER_SEND=1. --dry-run always wins. */
export function loadConfig(env: Env, argv: string[]): KeeperConfig {
  const send = (argv.includes("--send") || env.KEEPER_SEND === "1") && !argv.includes("--dry-run");
  return {
    core: need(env, "KEEPER_CORE"),
    rpcUrl: env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
    accountId: need(env, "KEEPER_ACCOUNT_ID"),
    keyFile: env.KEEPER_KEY_FILE || undefined,
    keyEnv: env.KEEPER_KEY || undefined,
    dryRun: !send,
    once: argv.includes("--once"),
    intervalMs: num(env.KEEPER_INTERVAL_MS, 30_000),
    minCallIntervalMs: num(env.KEEPER_MIN_CALL_INTERVAL_MS, 250),
    maxRetries: num(env.KEEPER_MAX_RETRIES, 5),
    solvencyEveryMs: num(env.KEEPER_SOLVENCY_EVERY_MS, 600_000),
    stuckAfterMs: num(env.KEEPER_STUCK_AFTER_MS, 900_000),
    alertRepeatMs: num(env.KEEPER_ALERT_REPEAT_MS, 3_600_000),
    maxPagesPerCycle: num(env.KEEPER_MAX_PAGES_PER_CYCLE, 40),
    refundBatch: Math.min(25, Math.max(1, num(env.KEEPER_REFUND_BATCH, 3))),
    webhookUrl: env.ALERT_WEBHOOK_URL || undefined,
    lockDir: env.KEEPER_LOCK_DIR || undefined,
    mainnetConfirmation: env.KRUXA_ALLOW_MAINNET || undefined,
  };
}

/** Testnet only. Anything that looks like mainnet is refused unless the owner's confirmation is set AND dry-run is off. */
export function assertNetworkAllowed(c: KeeperConfig): void {
  const looksMainnet = !c.accountId.endsWith(".testnet") || !c.core.endsWith(".testnet") || /mainnet/i.test(c.rpcUrl);
  if (!looksMainnet) return;
  if (c.mainnetConfirmation === MAINNET_CONFIRMATION && !c.dryRun) return;
  throw new Error(
    `refusing: account ${c.accountId}, core ${c.core} or RPC ${c.rpcUrl} is not testnet. Mainnet needs KRUXA_ALLOW_MAINNET=${MAINNET_CONFIRMATION} and --send (dry-run never runs on mainnet).`,
  );
}
