import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { specToJson } from "./compile.js";
import type { CeremonyResult } from "./ceremony.js";
import type { Leaf } from "./merkle.js";

export interface RecordExtras { cluster: string; mode: string; leaves: Leaf[]; squads?: { multisig: string; members: string[]; threshold: number; time_lock: number }; f0?: { signer_root: string; predecessor: string; path: string } }

/** Public ceremony record consumed by scripts/verify_solana.py. Contains no secrets. */
export function writeRecord(file: string, r: CeremonyResult, x: RecordExtras): void {
  const rec = {
    format: "kruxa-genesis-record/1", cluster: x.cluster, mode: x.mode, launch_id: r.spec.launchId.toString(),
    mint: r.mint, g_pub: new PublicKey(r.spec.gPub).toBase58(), spec: specToJson(r.spec), blockhash: r.blockhash, price: r.price,
    sigs: r.sigs, slot: r.slot, ceremony_hash: r.ceremonyHash, spec_hash: Buffer.from(r.compiled.specHash).toString("hex"),
    leaves: x.leaves.map((l) => ({ claimant: new PublicKey(l.claimant).toBase58(), unlocked: l.unlocked.toString(), locked: l.locked.toString() })),
    squads: x.squads ?? null, f0: x.f0 ?? null,
  };
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
}
