import type { Cluster } from "./cluster.js";

type Env = Record<string, string | undefined>;

/** The watcher's own switch for watching a MAINNET core and Solana mainnet-beta. It only ever observes: a mainnet genesis is run by the owner with
 *  genesis-cli (typed confirmation), never by a loop. This is separate from KRUXA_SOLANA_MAINNET_CONFIRMED, which the watcher never reads. */
export const WATCHER_MAINNET_ENV = "KRUXA_WATCHER_SOLANA_MAINNET";
export const WATCHER_MAINNET_VALUE = "I_CONFIRM_WATCHER_OBSERVES_ONLY";
const NOT_MAINNET_URL = /test|dev|local|sandbox|beta|127\.|0\.0\.0\.0/i;

export interface WatcherSetup { cluster: Cluster; core: string; nearRpc: string; send: boolean }

/** Validates the watcher's environment and returns what it may do. Throws on any combination that could touch mainnet unattended. */
export function watcherSetup(env: Env, argv: string[]): WatcherSetup {
  const cluster = (env.WATCHER_CLUSTER ?? "devnet") as Cluster;
  const core = env.WATCHER_CORE ?? "";
  const wantsSend = (argv.includes("--send") || env.WATCHER_SEND === "1") && !argv.includes("--dry-run");
  if (!["devnet", "local", "mainnet-beta"].includes(cluster)) throw new Error("refusing: WATCHER_CLUSTER must be devnet, local or mainnet-beta");
  if (cluster !== "mainnet-beta") {
    const nearRpc = env.NEAR_TESTNET_RPC ?? "https://test.rpc.fastnear.com";
    if (!core.endsWith(".testnet") || /mainnet/i.test(nearRpc)) throw new Error(`refusing: WATCHER_CORE ${core} must end .testnet and NEAR_TESTNET_RPC must not be mainnet`);
    return { cluster, core, nearRpc, send: wantsSend };
  }
  if (env[WATCHER_MAINNET_ENV] !== WATCHER_MAINNET_VALUE) throw new Error(`refusing: WATCHER_CLUSTER=mainnet-beta needs ${WATCHER_MAINNET_ENV}=${WATCHER_MAINNET_VALUE}`);
  if (wantsSend) throw new Error("refusing: the watcher never sends on mainnet (no --send, no WATCHER_SEND=1); the owner runs genesis-cli");
  const nearRpc = env.KRUXA_NEAR_RPC ?? "https://rpc.mainnet.near.org";
  if (!core || core.endsWith(".testnet") || NOT_MAINNET_URL.test(nearRpc)) throw new Error("refusing: a mainnet watcher needs a non-.testnet WATCHER_CORE and a mainnet KRUXA_NEAR_RPC");
  return { cluster, core, nearRpc, send: false };
}
