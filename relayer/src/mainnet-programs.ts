import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { ATA, JITO_MAINNET, METAPLEX, TOKENKEG } from "./solana-bytes.js";

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** Upgradeable-loader ProgramData header: tag(4) slot(8) option(1) authority(32) = 45 bytes, then the ELF (what `solana program dump` writes). */
const PROGRAMDATA_HEADER = 45;

/** Programs the genesis transactions invoke on mainnet-beta, pinned by the sha256 of `solana program dump` read on 2026-11-14.
 *  Both are immutable there (upgrade authority None), so a hash that matches today matches at mint time unless the cluster is not mainnet. */
export const PINNED_PROGRAMS: Record<string, { name: string; sha256: string }> = {
  [JITO_MAINNET]: { name: "Jito merkle-distributor", sha256: "51043e9794e69f0b071d741abd29fc274694ab60e412a1ed6d0dd38e258703ac" },
  [METAPLEX]: { name: "Metaplex Token Metadata", sha256: "31f0a627dba051a938de650464e55cc5397a4be0fd496929c1f9cf02fe5e9011" },
};
/** Loader-owned programs with no upgrade path to pin here: only checked as executable. */
const EXECUTABLE_ONLY = [TOKENKEG, ATA];

export interface ProgramFacts { authority: string | null; sha256: string }

/** Pure: reads the upgrade authority and the ELF hash out of a ProgramData account. */
export function programDataFacts(data: Uint8Array): ProgramFacts {
  const buf = Buffer.from(data);
  if (buf.length <= PROGRAMDATA_HEADER || buf.readUInt32LE(0) !== 3) throw new Error("not an upgradeable-loader ProgramData account");
  const authority = buf[12] === 1 ? new PublicKey(buf.subarray(13, 45)).toBase58() : null;
  return { authority, sha256: createHash("sha256").update(buf.subarray(PROGRAMDATA_HEADER)).digest("hex") };
}

/** Pure: the refusals for one pinned program. */
export function checkPinned(id: string, facts: ProgramFacts): string[] {
  const pin = PINNED_PROGRAMS[id];
  if (!pin) return [`${id} is not a pinned program`];
  const bad: string[] = [];
  if (facts.authority !== null) bad.push(`${pin.name} ${id} is upgradeable by ${facts.authority} (expected immutable)`);
  if (facts.sha256 !== pin.sha256) bad.push(`${pin.name} ${id} binary sha256 ${facts.sha256} is not the pinned ${pin.sha256}`);
  return bad;
}

async function factsOf(conn: Connection, id: string): Promise<ProgramFacts> {
  const acct = await conn.getAccountInfo(new PublicKey(id), "finalized");
  if (!acct?.executable || acct.owner.toBase58() !== UPGRADEABLE_LOADER) throw new Error(`preflight: ${id} is not an executable upgradeable-loader program on this cluster`);
  const data = await conn.getAccountInfo(new PublicKey(acct.data.subarray(4, 36)), "finalized");
  if (!data) throw new Error(`preflight: program data of ${id} not found`);
  return programDataFacts(data.data);
}

/** mainnet-beta preflight, before anything irreversible: the distributor must be the real Jito program at its real id (a patched copy at our own id,
 *  as on devnet, is refused), and Jito and Metaplex must be the pinned immutable binaries. */
export async function assertMainnetPrograms(conn: Connection, jitoProgram: string): Promise<void> {
  if (jitoProgram !== JITO_MAINNET) throw new Error(`refusing: mainnet-beta genesis must use the real Jito distributor ${JITO_MAINNET}, not ${jitoProgram}`);
  const bad: string[] = [];
  for (const id of Object.keys(PINNED_PROGRAMS)) bad.push(...checkPinned(id, await factsOf(conn, id)));
  for (const id of EXECUTABLE_ONLY) if (!(await conn.getAccountInfo(new PublicKey(id), "finalized"))?.executable) bad.push(`${id} is not executable`);
  if (bad.length) throw new Error(`refusing: mainnet program preflight failed: ${bad.join("; ")}`);
}

/** Account sizes of the genesis accounts: SPL token account, Metaplex metadata (fixed 607 bytes, measured by simulation for any name, symbol and uri length), Jito MerkleDistributor. */
export const ACCOUNT_SPACE = { tokenAccount: 165, metadata: 607, distributor: 240 };
/** The Metaplex Token Metadata creation fee, paid into the metadata account (an immutable program: 13,733,800 total = 3,733,800 rent + 10,000,000 fee). */
export const METAPLEX_CREATE_FEE_LAMPORTS = 10_000_000;
/** compile.ts creates the mint account with this explicit lamport amount (the old 6,960 per byte rent for 82 bytes). */
const MINT_ACCOUNT_LAMPORTS = 1_461_600;

export interface RentQuote { tokenAccount: number; metadata: number; distributor: number }

/** Pure: the lamports G spends on non-fee items, from live rent quotes. Reserve ATA, mint and metadata always; vault ATA and distributor with a distributor. */
export function nonFeeFromRent(rent: RentQuote, hasDistributor: boolean): number {
  return MINT_ACCOUNT_LAMPORTS + rent.tokenAccount + rent.metadata + METAPLEX_CREATE_FEE_LAMPORTS + (hasDistributor ? rent.tokenAccount + rent.distributor : 0);
}

/** Rent per byte is a cluster parameter (5,080 per byte read from mainnet-beta on 2026-11-14; compile.ts still carries the older 6,960 per byte for the 82 byte mint). G is funded with an exactly calibrated amount, and F0 cannot sweep, so a
 *  stale table either fails the transaction (short) or leaves G above dust (long). Refuse before funding when the live rent no longer reproduces the calibrated figure. */
export async function assertRentCalibration(conn: Connection, hasDistributor: boolean, calibrated: number): Promise<number> {
  const [tokenAccount, metadata, distributor] = await Promise.all(
    [ACCOUNT_SPACE.tokenAccount, ACCOUNT_SPACE.metadata, ACCOUNT_SPACE.distributor].map((n) => conn.getMinimumBalanceForRentExemption(n)),
  );
  const live = nonFeeFromRent({ tokenAccount: tokenAccount!, metadata: metadata!, distributor: distributor! }, hasDistributor);
  if (live !== calibrated) throw new Error(`refusing: live rent gives ${live} lamports for the genesis accounts but the calibrated figure is ${calibrated}; re-measure (docs/MAINNET-SOLANA-GENESIS.md section 4) before funding G`);
  return live;
}
