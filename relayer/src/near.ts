import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
  const near = await connect({ networkId: "testnet", nodeUrl: "https://rpc.testnet.near.org", keyStore });
  if (near.connection.networkId !== "testnet") throw new Error("refusing: NEAR network is not testnet");
  return near.account(k.account_id);
}
