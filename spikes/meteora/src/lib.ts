import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type Signer } from "@solana/web3.js";

export type Net = "devnet" | "localnet";
export const RPC: Record<Net, string> = { devnet: "https://api.devnet.solana.com", localnet: "http://127.0.0.1:18899" };
const HERE = dirname(fileURLToPath(import.meta.url));
export const SECRET_DIR = join(homedir(), ".kruxa-secrets");

export interface Row { id: string; ok: boolean; sigs: string[]; detail: string }
export interface State { rows: Row[]; vars: Record<string, string> }

export const statePath = (net: Net): string => join(HERE, "..", `state.${net}.json`);
export const resultsPath = (net: Net): string => join(HERE, "..", `results.${net}.json`);

export function loadState(net: Net): State {
  const p = statePath(net);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as State) : { rows: [], vars: {} };
}

export function saveState(net: Net, s: State): void {
  writeFileSync(statePath(net), JSON.stringify(s, null, 2));
  writeFileSync(resultsPath(net), JSON.stringify(s.rows, null, 2));
}

/** Secret never printed; only the public key is ever logged. */
export function loadKeypair(name: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(SECRET_DIR, name), "utf8")) as number[]));
}

export async function send(c: Connection, tx: Transaction, signers: Signer[]): Promise<string> {
  return sendAndConfirmTransaction(c, tx, signers, { commitment: "confirmed", skipPreflight: false });
}

export const sol = (lamports: number): string => (lamports / 1e9).toFixed(6);
export const pk = (s: string | undefined): PublicKey => new PublicKey(s ?? "");
