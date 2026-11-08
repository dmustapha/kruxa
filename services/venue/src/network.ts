import { Connection } from "@solana/web3.js";

export type Network = "devnet" | "mainnet" | "localnet";

export const GENESIS_HASH: Record<Exclude<Network, "localnet">, string> = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};

export const DEFAULT_RPC: Record<Network, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
  localnet: "http://127.0.0.1:18899",
};

export interface NetworkRequest {
  network: Network;
  mainnetIKnow: boolean;
  env: Record<string, string | undefined>;
}

/** Mainnet needs BOTH the explicit flag and the per-action confirmation env var. */
export function assertNetworkAllowed(req: NetworkRequest): void {
  if (req.network !== "mainnet") return;
  const confirmed = req.env.DAMI_PER_ACTION_CONFIRMED;
  const envOk = confirmed !== undefined && confirmed !== "" && confirmed !== "0" && confirmed !== "false";
  if (!req.mainnetIKnow || !envOk) {
    throw new Error(
      "refused: mainnet needs --mainnet-i-know AND env DAMI_PER_ACTION_CONFIRMED set. " +
        "This tool only builds unsigned plans; it never signs or sends.",
    );
  }
}

/** Guards against an RPC URL that points at a different cluster than the declared network. */
export async function assertClusterMatches(connection: Connection, network: Network): Promise<void> {
  if (network === "localnet") return;
  const hash = await connection.getGenesisHash();
  if (hash !== GENESIS_HASH[network]) {
    throw new Error(`refused: RPC genesis hash ${hash} does not match declared network ${network}`);
  }
}
