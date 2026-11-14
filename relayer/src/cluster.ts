import { Connection } from "@solana/web3.js";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** Solana mainnet-beta genesis hash. Read back from the cluster with `solana genesis-hash -u mainnet-beta` and `getGenesisHash` on 2026-11-14. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
export const LOCAL_RPC = "http://127.0.0.1:28899";

/** The owner's own switch for any Solana mainnet-beta use by this relayer (dry-run included). Set on the command line of the run, never in a saved file. */
export const MAINNET_CONFIRM_ENV = "KRUXA_SOLANA_MAINNET_CONFIRMED";
export const MAINNET_CONFIRM_VALUE = "I_CONFIRM_DAMI_RUNS_THIS";

export type Cluster = "devnet" | "local" | "mainnet-beta";
type Env = Record<string, string | undefined>;

/** What the core's GenesisSpec must say about its target cluster; null for a labelled local rehearsal (the standalone spec carries the devnet hash). */
export function expectedSpecCluster(cluster: Cluster): { chain: string; hash: string } | null {
  if (cluster === "devnet") return { chain: "solana-devnet", hash: DEVNET_GENESIS_HASH };
  if (cluster === "mainnet-beta") return { chain: "solana-mainnet", hash: MAINNET_GENESIS_HASH };
  return null;
}

/** Refuses any cluster the caller did not name. Call before building and before sending.
 *  mainnet-beta additionally needs the owner's confirm env AND an RPC whose genesis hash is the real mainnet-beta hash;
 *  devnet and local refuse an RPC that reports mainnet-beta. */
export async function assertCluster(conn: Connection, cluster: Cluster, env: Env = process.env): Promise<void> {
  if (cluster === "mainnet-beta" && env[MAINNET_CONFIRM_ENV] !== MAINNET_CONFIRM_VALUE) {
    throw new Error(`refusing: --cluster mainnet-beta needs ${MAINNET_CONFIRM_ENV}=${MAINNET_CONFIRM_VALUE} on the command line of this run`);
  }
  const hash = await conn.getGenesisHash();
  if (cluster === "mainnet-beta" && hash !== MAINNET_GENESIS_HASH) {
    throw new Error(`refusing: genesis hash ${hash} is not Solana mainnet-beta (${MAINNET_GENESIS_HASH})`);
  }
  if (cluster !== "mainnet-beta" && hash === MAINNET_GENESIS_HASH) {
    throw new Error(`refusing: --cluster ${cluster} but the RPC reports mainnet-beta`);
  }
  if (cluster === "devnet" && hash !== DEVNET_GENESIS_HASH) {
    throw new Error(`refusing: genesis hash ${hash} is not Solana devnet (${DEVNET_GENESIS_HASH})`);
  }
  if (cluster === "local" && hash === DEVNET_GENESIS_HASH) {
    throw new Error("refusing: --cluster local but the RPC reports devnet");
  }
  if (cluster === "local" && !/127\.0\.0\.1|localhost/.test(conn.rpcEndpoint)) {
    throw new Error("refusing: local cluster must be a localhost RPC");
  }
}

export function rpcFor(cluster: Cluster, env: Env = process.env): string {
  if (cluster === "local") return LOCAL_RPC;
  if (cluster === "mainnet-beta") return env.SOL_MAINNET_RPC ?? DEFAULT_MAINNET_RPC;
  return env.SOL_DEVNET_RPC ?? DEFAULT_DEVNET_RPC;
}
