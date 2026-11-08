import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { decodeSpec, hex } from "./compile.js";
import type { CeremonyResult } from "./ceremony.js";
import type { Leaf } from "./merkle.js";

export interface RecordExtras {
  cluster: string; mode: string; launchId: bigint; leaves: Leaf[]; core: string;
  squads?: { multisig: string; members: string[]; threshold: number; time_lock: number };
  f0?: { signer_root: string; predecessor: string; path: string }; sources: string;
}

/** Public ceremony record consumed by scripts/verify_solana.py. Contains no secrets. */
export function writeRecord(file: string, r: CeremonyResult, x: RecordExtras): void {
  const spec = decodeSpec(r.specBytes);
  const rec = {
    format: "kruxa-genesis-record/2", cluster: x.cluster, mode: x.mode, launch_id: x.launchId.toString(), core: x.core,
    mint: r.mint, g_pub: new PublicKey(spec.gPub).toBase58(), spec_hex: hex(r.specBytes), spec_hash: hex(r.compiled.specHash),
    params: { jito_program: new PublicKey(r.params.jitoProgram).toBase58(), metadata_uri: r.params.metadataUri, clock_ts: r.params.clockTs.toString() },
    blockhash: r.blockhash, price: r.price, sigs: r.sigs, slot: r.slot, ceremony_hash: r.ceremonyHash, sign_ms: r.timing.signMs,
    leaves: x.leaves.map((l) => ({ claimant: new PublicKey(l.claimant).toBase58(), unlocked: l.unlocked.toString(), locked: l.locked.toString() })),
    squads: x.squads ?? null, f0: x.f0 ?? null, spec_source: x.sources,
  };
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
}
