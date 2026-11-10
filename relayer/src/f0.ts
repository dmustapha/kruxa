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
  /** One entry per live sign call: what the real signer returned, how long it took and what it cost. */
  signLog?: SignLogEntry[];
  derivedPub(): Promise<Uint8Array>;
  /** Contract-gated backends: registers sha256(message) on the core for tx slot `txIndex` (0 = create, 1 = seal) before it may be signed. */
  register?(message: Uint8Array, txIndex: number): Promise<void>;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface SignLogEntry { tx: string; ms: number; response: string; gas_burnt_tgas: number; near_burnt: string }

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

  /** F0_BACKEND=sandbox: local stand-in key. F0_BACKEND=direct: the relayer account calls the MPC signer itself (no contract gate, legacy).
   *  Otherwise, with a core account: the core's own gate (register_f0_message then sign_genesis); without one the legacy direct backend. */
  static async fromEnv(launch: bigint, coreId?: string): Promise<F0Signer> {
    const which = process.env.F0_BACKEND;
    if (which === "sandbox") return F0Signer.create(sandboxBackend());
    if (coreId && which !== "direct") return F0Signer.create(await contractBackend(launch, coreId));
    return F0Signer.create(await nearBackend(launch));
  }

  pub(): Uint8Array { return this.publicKey; }

  /** Local gate plus, for a contract-gated backend, the on-chain registration of the same hashes. `txIndex` is the slot of messages[0]. */
  async expect(messages: Uint8Array[], txIndex = 0): Promise<void> {
    this.allowed = new Set(messages.map((m) => hex(sha256(m))));
    for (const [n, m] of messages.entries()) await this.backend.register?.(m, txIndex + n);
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

/** The signer's answer is `{signature:[64 bytes]}` or `{scheme,signature}` or `{Ed25519:{signature}}`. */
export function parseSignature(text: string): Uint8Array {
  const parsed = JSON.parse(text) as { signature?: number[]; Ed25519?: { signature?: number[] } };
  const raw = parsed.signature ?? parsed.Ed25519?.signature;
  if (!raw || raw.length !== 64) throw new Error("unexpected signature shape (UNVERIFIED response format)");
  return Uint8Array.from(raw);
}

/** The slice of a near-api-js Account the contract backend needs (injectable for tests). */
export interface NearCaller {
  functionCall(a: { contractId: string; methodName: string; args: object; gas: bigint; attachedDeposit: bigint }): Promise<{
    status: unknown; transaction: { hash: string }; transaction_outcome: { outcome: { gas_burnt: number; tokens_burnt: string } };
    receipts_outcome: Array<{ outcome: { gas_burnt: number; tokens_burnt: string } }>;
  }>;
}

export const CORE_CALL_GAS = 300n * 10n ** 12n;

/** F0 through the core's gate (REQ-2): `register_f0_message(launch, slot, sha256)` then `sign_genesis(launch, slot, message_hex)`. The core builds the path
 *  `kruxa:genesis:<launch>` itself and calls the MPC signer as predecessor = the CORE account, so the key is derived for (core, path), not for the relayer.
 *  The signature is the call's return value (no callback). `signerRoot` is the MPC root key for domain 1. */
export function contractBackendWith(account: NearCaller, coreId: string, launch: bigint, signerRoot: string): SignBackend {
  const path = `kruxa:genesis:${launch}`;
  const pub = derivedKeyBytes(signerRoot, coreId, path);
  const slotByHash = new Map<string, number>();
  const signLog: SignLogEntry[] = [];
  const call = (methodName: string, args: object) => account.functionCall({ contractId: coreId, methodName, args, gas: CORE_CALL_GAS, attachedDeposit: 0n });
  return {
    signLog,
    derivation: { signer_root: signerRoot, predecessor: coreId, path },
    label: `NEAR testnet ${TESTNET_SIGNER} via core gate ${coreId} (predecessor ${coreId}, path ${path})`,
    derivedPub: async () => pub,
    register: async (message, txIndex) => {
      const h = hex(sha256(message));
      await call("register_f0_message", { launch_id: launch.toString(), tx_index: txIndex, message_sha256: h });
      slotByHash.set(h, txIndex);
    },
    sign: async (message) => {
      const slot = slotByHash.get(hex(sha256(message)));
      if (slot === undefined) throw new PolicyMismatch();
      const t0 = Date.now();
      const out = await call("sign_genesis", { launch_id: launch.toString(), tx_index: slot, message_hex: hex(message) });
      const status = out.status as { SuccessValue?: string };
      if (!status.SuccessValue) throw new Error(`sign_genesis failed: ${JSON.stringify(out.status).slice(0, 200)}`);
      const text = Buffer.from(status.SuccessValue, "base64").toString("utf8");
      const outcomes = [out.transaction_outcome, ...out.receipts_outcome];
      const gas = outcomes.reduce((n, o) => n + Number(o.outcome.gas_burnt), 0);
      const burnt = outcomes.reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n);
      signLog.push({ tx: out.transaction.hash, ms: Date.now() - t0, response: text.slice(0, 400), gas_burnt_tgas: gas / 1e12, near_burnt: (Number(burnt) / 1e24).toFixed(6) });
      return parseSignature(text);
    },
  };
}

/** Live: the relayer account (the core's genesis_relayer) calls the core's gate. Testnet only (testnetAccount refuses anything else). */
export async function contractBackend(launch: bigint, coreId: string): Promise<SignBackend> {
  if (!coreId.endsWith(".testnet")) throw new Error("refusing: core account is not a .testnet account");
  const { testnetAccount } = await import("./near.js");
  const account = await testnetAccount();
  const rootPk = (await account.viewFunction({ contractId: TESTNET_SIGNER, methodName: "public_key", args: { domain_id: 1 } })) as string;
  return contractBackendWith(account as unknown as NearCaller, coreId, launch, rootPk);
}

interface NearKeyFile { account_id: string; secret_key: string }

/** Live backend: NEAR testnet account calls v1.signer-prod.testnet.sign (predecessor = that account, 1 yocto, 300 Tgas). */
export async function nearBackend(launch: bigint): Promise<SignBackend> {
  const { connect, keyStores, KeyPair } = await import("near-api-js");
  const file = process.env.KRUXA_NEAR_KEY ?? `${homedir()}/.kruxa-secrets/genesis/near-testnet-f0.json`;
  const k: NearKeyFile = JSON.parse(readFileSync(file, "utf8"));
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", k.account_id, KeyPair.fromString(k.secret_key as `ed25519:${string}`));
  const near = await connect({ networkId: "testnet", nodeUrl: (process.env.NEAR_TESTNET_RPC ?? "https://test.rpc.fastnear.com"), keyStore });
  if (near.connection.networkId !== "testnet") throw new Error("refusing: NEAR network is not testnet");
  const account = await near.account(k.account_id);
  const path = `kruxa:genesis:${launch}`;
  const rootPk = (await account.viewFunction({ contractId: TESTNET_SIGNER, methodName: "public_key", args: { domain_id: 1 } })) as string;
  const pub = derivedKeyBytes(rootPk, k.account_id, path);
  const signLog: SignLogEntry[] = [];
  return {
    signLog,
    derivation: { signer_root: rootPk, predecessor: k.account_id, path },
    label: `NEAR testnet ${TESTNET_SIGNER} (predecessor ${k.account_id}, path ${path})`,
    derivedPub: async () => pub,
    sign: async (message) => {
      const t0 = Date.now();
      const out = await account.functionCall({
        contractId: TESTNET_SIGNER, methodName: "sign", gas: SIGN_GAS, attachedDeposit: 1n,
        args: { request: { payload_v2: { Eddsa: hex(message) }, path, domain_id: 1 } },
      });
      const status = out.status as { SuccessValue?: string };
      if (!status.SuccessValue) throw new Error(`sign failed: ${JSON.stringify(out.status).slice(0, 200)}`);
      const text = Buffer.from(status.SuccessValue, "base64").toString("utf8");
      const outcomes = [out.transaction_outcome, ...out.receipts_outcome];
      const gas = outcomes.reduce((n, o) => n + Number(o.outcome.gas_burnt), 0);
      const burnt = outcomes.reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n);
      signLog.push({ tx: out.transaction.hash as string, ms: Date.now() - t0, response: text.slice(0, 400), gas_burnt_tgas: gas / 1e12, near_burnt: (Number(burnt) / 1e24).toFixed(6) });
      return parseSignature(text);
    },
  };
}
