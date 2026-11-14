import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, KeyPair, keyStores } from "near-api-js";
import type { Account } from "near-api-js";

export interface NearKeyFile { account_id: string; secret_key: string }

export function loadNearKey(): NearKeyFile {
  const file = process.env.KRUXA_NEAR_KEY ?? `${homedir()}/.kruxa-secrets/genesis/near-testnet-f0.json`;
  return JSON.parse(readFileSync(file, "utf8")) as NearKeyFile;
}

/** The relayer's NEAR TESTNET account. Refuses anything that is not testnet. */
export async function testnetAccount(): Promise<Account> {
  const k = loadNearKey();
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", k.account_id, KeyPair.fromString(k.secret_key as `ed25519:${string}`));
  const near = await connect({ networkId: "testnet", nodeUrl: (process.env.NEAR_TESTNET_RPC ?? "https://test.rpc.fastnear.com"), keyStore });
  if (near.connection.networkId !== "testnet") throw new Error("refusing: NEAR network is not testnet");
  return near.account(k.account_id);
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Reads a NEAR key file for MAINNET: outside the repo, mode 600, near-cli credentials JSON. Same rules as scripts/mainnet/lib.mjs. The key is never printed. */
export function loadMainnetNearKey(env: Record<string, string | undefined> = process.env): NearKeyFile {
  const named = env.KRUXA_KEY_FILE;
  if (!named) throw new Error("refusing: KRUXA_KEY_FILE is not set (NEAR mainnet key file, mode 600, outside the repo)");
  const abs = resolve(named.replace(/^~/, homedir()));
  if (abs.startsWith(REPO + sep)) throw new Error("refusing: KRUXA_KEY_FILE must live outside the repo");
  if ((statSync(abs).mode & 0o077) !== 0) throw new Error(`refusing: KRUXA_KEY_FILE ${abs} must be mode 600`);
  const j = JSON.parse(readFileSync(abs, "utf8")) as { account_id?: string; private_key?: string; secret_key?: string };
  const secret = j.private_key ?? j.secret_key;
  if (!j.account_id || !secret || !/^ed25519:/.test(secret)) throw new Error("refusing: KRUXA_KEY_FILE must be JSON with account_id and an ed25519: private_key");
  return { account_id: j.account_id, secret_key: secret };
}

/** The relayer's NEAR MAINNET account (the core's genesis_relayer). Refuses a testnet account or an RPC whose chain is not mainnet. */
export async function mainnetAccount(env: Record<string, string | undefined> = process.env): Promise<Account> {
  const k = loadMainnetNearKey(env);
  if (k.account_id.endsWith(".testnet")) throw new Error("refusing: a .testnet account is not a mainnet relayer");
  const url = env.KRUXA_NEAR_RPC ?? "https://rpc.mainnet.near.org";
  if (/test|dev|local|sandbox|beta|127\.|0\.0\.0\.0/i.test(url)) throw new Error(`refusing NEAR RPC ${url}: not a mainnet endpoint`);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("mainnet", k.account_id, KeyPair.fromString(k.secret_key as `ed25519:${string}`));
  const near = await connect({ networkId: "mainnet", nodeUrl: url, keyStore });
  const status = (await near.connection.provider.status()) as { chain_id?: string };
  if (status.chain_id !== "mainnet") throw new Error(`refusing: NEAR RPC reports chain_id ${status.chain_id}, not mainnet`);
  return near.account(k.account_id);
}
