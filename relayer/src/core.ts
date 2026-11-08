import { createHash } from "node:crypto";
import { encodeSpec, SQUADS, type Spec } from "./compile.js";
import { DEVNET_GENESIS_HASH } from "./cluster.js";
import { b58d, createWithSeed, sha256, TOKENKEG } from "./solana-bytes.js";
import { buildMerkle, type Leaf } from "./merkle.js";

/** The slice of the NEAR core contract the relayer talks to (docs/interfaces/REQ-1-genesis-relayer.md). */
export interface CoreClient {
  label: string;
  /** commit_genesis (and, for the real core, every build_root_page); resolves once the spec is final. */
  commitGenesis(launchId: bigint, gPub: Uint8Array): Promise<void>;
  /** Borsh bytes of the committed GenesisSpec (view get_genesis_spec), hash-checked by the ceremony. */
  specBytes(launchId: bigint): Promise<Uint8Array>;
  specHashOnChain(launchId: bigint): Promise<string>;
  confirmGenesis(launchId: bigint, mint: Uint8Array, sigs: string[], slot: number, ceremonyHash: string): Promise<void>;
  abortGenesis(launchId: bigint, reason: string): Promise<void>;
}

export class GenesisRefused extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface StandaloneOptions {
  verdicts: Record<string, "PASS" | "FAIL">; mode: "F1" | "F0"; multisig: Uint8Array; reserveAmount: bigint; metadataUri: string; leaves?: Leaf[];
}

/** STANDALONE core stand-in: builds a core-shaped GenesisSpec for a PASS launch with a reserve bucket and optional Solana holders.
 *  It is NOT the real core: nothing is committed on NEAR. Used only when the live core2 launch path is unavailable. */
export class StandaloneCore implements CoreClient {
  label = "STANDALONE core stand-in (spec NOT committed on NEAR)";
  private committed = new Map<string, Uint8Array>();
  readonly confirmed = new Map<string, { mint: string; sigs: string[]; slot: number; ceremonyHash: string }>();
  constructor(private readonly o: StandaloneOptions) {}

  async commitGenesis(launchId: bigint, gPub: Uint8Array): Promise<void> {
    const id = launchId.toString();
    if (this.o.verdicts[id] !== "PASS") throw new GenesisRefused("R_GENESIS_STATE");
    if (this.committed.has(id)) throw new GenesisRefused("R_GENESIS_ALREADY");
    const reserve = this.o.reserveAmount;
    const leaves = this.o.leaves ?? [];
    const total = leaves.reduce((n, l) => n + l.unlocked, 0n);
    const spec: Spec = {
      specVersion: 1, compilerVersion: "gs-compiler/1.0.0", chain: "solana-devnet", clusterGenesisHash: b58d(DEVNET_GENESIS_HASH), launchId: id,
      nearContract: "standalone", nearBlockHeight: 0n, mode: this.o.mode === "F0" ? 1 : 0, gPub, mintSeed: id,
      mintAddress: createWithSeed(gPub, id, TOKENKEG), tokenProgram: b58d(TOKENKEG), decimals: 6, supplyTotal: reserve + total,
      name: `Kruxa Rehearsal ${id}`, symbol: `KRX${id}`, metadataUriSha256: sha256(new TextEncoder().encode(this.o.metadataUri)),
      metadataHash: sha256(new TextEncoder().encode("rehearsal")), mintAuthorityNone: true, freezeAuthorityNone: true, extensionsAllowed: false,
      buckets: [[0, reserve], [1, total]], squadsMultisig: this.o.multisig, vaultIndex: 0, disclosure: 0, merkleRoot: leaves.length ? buildMerkle(leaves).root : new Uint8Array(32),
      maxTotalClaim: total, maxNumNodes: leaves.length, clawbackDays: 90,
    };
    this.committed.set(id, encodeSpec(spec));
  }

  async specBytes(launchId: bigint): Promise<Uint8Array> { return this.committed.get(launchId.toString())!; }
  async specHashOnChain(launchId: bigint): Promise<string> { return createHash("sha256").update(this.committed.get(launchId.toString())!).digest("hex"); }
  async confirmGenesis(launchId: bigint, mint: Uint8Array, sigs: string[], slot: number, ceremonyHash: string): Promise<void> {
    this.confirmed.set(launchId.toString(), { mint: Buffer.from(mint).toString("hex"), sigs, slot, ceremonyHash });
  }
  async abortGenesis(): Promise<void> {}
}

export const SQUADS_PROGRAM = SQUADS;
