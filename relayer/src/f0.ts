import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import nacl from "tweetnacl";
import { derivedKeyBytes } from "./derive.js";
import type { GenesisSigner } from "./signer.js";
import { sha256 } from "./solana-bytes.js";

export const TESTNET_SIGNER = "v1.signer-prod.testnet";
export const SIGN_GAS = 300n * 10n ** 12n;

/** Where the signature comes from: the real testnet MPC signer, or a labelled SANDBOX stand-in. */
export interface SignBackend {
  label: string;
  /** Inputs of the offline derivation, published in the ceremony record so verify C27 can recompute the key. */
  derivation?: { signer_root: string; predecessor: string; path: string };
  derivedPub(): Promise<Uint8Array>;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export class PolicyMismatch extends Error {
  constructor() { super("E_POLICY_MISMATCH: message hash is not the compile() output"); }
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** F0: G is the NEAR-MPC child key for path kruxa:genesis:<launch>. The policy gate signs only messages whose
 *  sha256 equals a hash registered from compile(spec, blockhash, price) (the contract stores it; the sandbox registers it client-side). */
export class F0Signer implements GenesisSigner {
  readonly mode = "F0" as const;
  private allowed = new Set<string>();
  private constructor(private readonly publicKey: Uint8Array, readonly backend: SignBackend) {}

  static async create(backend: SignBackend): Promise<F0Signer> {
    return new F0Signer(await backend.derivedPub(), backend);
  }

  static async fromEnv(launch: bigint): Promise<F0Signer> {
    if (process.env.F0_BACKEND === "sandbox") return F0Signer.create(sandboxBackend());
    return F0Signer.create(await nearBackend(launch));
  }

  pub(): Uint8Array { return this.publicKey; }

  expect(messages: Uint8Array[]): void {
    this.allowed = new Set(messages.map((m) => hex(sha256(m))));
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    if (!this.allowed.has(hex(sha256(message)))) throw new PolicyMismatch();
    const sig = await this.backend.sign(message);
    if (!nacl.sign.detached.verify(message, sig, this.publicKey)) throw new Error("backend signature does not verify against the derived key; NOT broadcasting");
    return sig;
  }

  destroy(): void { this.allowed.clear(); }
}

export function sandboxBackend(): SignBackend {
  const kp = nacl.sign.keyPair();
  return { label: "SANDBOX (local key stands in for the MPC)", derivedPub: async () => kp.publicKey, sign: async (m) => nacl.sign.detached(m, kp.secretKey) };
}

interface NearKeyFile { account_id: string; secret_key: string }

/** Live backend: NEAR testnet account calls v1.signer-prod.testnet.sign (predecessor = that account, 1 yocto, 300 Tgas). */
export async function nearBackend(launch: bigint): Promise<SignBackend> {
  const { connect, keyStores, KeyPair } = await import("near-api-js");
  const file = process.env.KRUXA_NEAR_KEY ?? `${homedir()}/.kruxa-secrets/genesis/near-testnet-f0.json`;
  const k: NearKeyFile = JSON.parse(readFileSync(file, "utf8"));
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", k.account_id, KeyPair.fromString(k.secret_key as `ed25519:${string}`));
  const near = await connect({ networkId: "testnet", nodeUrl: "https://rpc.testnet.near.org", keyStore });
  if (near.connection.networkId !== "testnet") throw new Error("refusing: NEAR network is not testnet");
  const account = await near.account(k.account_id);
  const path = `kruxa:genesis:${launch}`;
  const rootPk = (await account.viewFunction({ contractId: TESTNET_SIGNER, methodName: "public_key", args: { domain_id: 1 } })) as string;
  const pub = derivedKeyBytes(rootPk, k.account_id, path);
  return {
    derivation: { signer_root: rootPk, predecessor: k.account_id, path },
    label: `NEAR testnet ${TESTNET_SIGNER} (predecessor ${k.account_id}, path ${path})`,
    derivedPub: async () => pub,
    sign: async (message) => {
      const out = await account.functionCall({
        contractId: TESTNET_SIGNER, methodName: "sign", gas: SIGN_GAS, attachedDeposit: 1n,
        args: { request: { payload_v2: { Eddsa: hex(message) }, path, domain_id: 1 } },
      });
      const status = out.status as { SuccessValue?: string };
      if (!status.SuccessValue) throw new Error(`sign failed: ${JSON.stringify(out.status).slice(0, 200)}`);
      const parsed = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8")) as { signature?: number[] };
      if (!parsed.signature || parsed.signature.length !== 64) throw new Error("unexpected signature shape");
      return Uint8Array.from(parsed.signature);
    },
  };
}
