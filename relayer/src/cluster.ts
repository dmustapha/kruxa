import { Connection } from "@solana/web3.js";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
export const LOCAL_RPC = "http://127.0.0.1:28899";

export type Cluster = "devnet" | "local";

/** Refuses any cluster that is not devnet (or an explicitly labelled local validator). Call before building and before sending. */
export async function assertCluster(conn: Connection, cluster: Cluster): Promise<void> {
  const hash = await conn.getGenesisHash();
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

export function rpcFor(cluster: Cluster): string {
  return cluster === "local" ? LOCAL_RPC : process.env.SOL_DEVNET_RPC ?? DEFAULT_DEVNET_RPC;
}
