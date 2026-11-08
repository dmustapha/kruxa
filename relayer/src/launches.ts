import { Keypair, PublicKey } from "@solana/web3.js";
import { JITO_MAINNET, b58d, sha256 } from "./solana-bytes.js";
import { buildMerkle, type Leaf } from "./merkle.js";
import type { GenesisSpec } from "./compile.js";

/** Rehearsal launch table. 1 and 3 are PASS launches, 2 is FAIL. Devnet / local only. */
export const VERDICTS: Record<string, "PASS" | "FAIL"> = { "1": "PASS", "2": "FAIL", "3": "PASS", "4": "PASS", "5": "PASS", "6": "PASS" };

/** The Jito program requires start and end strictly in the future at new_distributor time. */
export const START_DELAY_SEC = 75n;
/** F0 needs headroom for two MPC round trips (mainnet p95 15 s each) before tx2 lands. */
export const F0_START_DELAY_SEC = 150n;

export interface Holders { test: Keypair; leaves: Leaf[] }

const pk = (tag: string): Uint8Array => sha256(new TextEncoder().encode(`kruxa-rehearsal:${tag}`));

/** One real throwaway holder (for the claim test) plus four deterministic placeholder claimants. */
export function makeHolders(): Holders {
  const test = Keypair.generate();
  const fill: Leaf[] = [1, 2, 3, 4].map((n) => ({ claimant: pk(`holder-${n}`), unlocked: BigInt(n) * 1_000_000n, locked: 0n }));
  return { test, leaves: [{ claimant: test.publicKey.toBytes(), unlocked: 5_000_000n, locked: 0n }, ...fill] };
}

export interface SpecEnv { jitoProgram: string; reserveOwner?: string; nowSec: bigint; delaySec: bigint }

export function buildLaunchSpec(launchId: bigint, gPub: Uint8Array, holders: Holders, env: SpecEnv): GenesisSpec {
  const tree = buildMerkle(holders.leaves);
  const total = holders.leaves.reduce((n, l) => n + l.unlocked, 0n);
  return {
    launchId, gPub, decimals: 6, name: `Kruxa Rehearsal ${launchId}`, symbol: `KRX${launchId}`,
    metadataUri: `https://kruxa.example/rehearsal/${launchId}.json`, mintLamports: 1_461_600n,
    reserveOwner: env.reserveOwner ? b58d(env.reserveOwner) : pk("reserve"), lpOwner: pk("lp"), clawbackOwner: pk("clawback"),
    reserveAmount: 200_000_000_000n, lpAmount: 100_000_000_000n, jitoProgram: b58d(env.jitoProgram || JITO_MAINNET),
    merkleRoot: tree.root, maxTotalClaim: total, maxNumNodes: BigInt(holders.leaves.length),
    startTs: env.nowSec + env.delaySec, endTs: env.nowSec + env.delaySec + 60n, clawbackTs: env.nowSec + 90n * 86_400n,
  };
}

export const isPubkey = (s: string): boolean => { try { new PublicKey(s); return true; } catch { return false; } };
