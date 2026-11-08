/** TypeScript genesis compiler gs-compiler/1.0.0. Python (tools/genesis/ref/compile.py) is the reference; a mismatch is fixed HERE. */
import {
  ATA, COMPUTE_BUDGET, METAPLEX, SYSTEM, TOKENKEG, ataOf, b58d, b58e, compileMessage, concat, createWithSeed, findPda,
  i64, meta, sha256, u16, u32, u64, u8, type Ix,
} from "./solana-bytes.js";

export const COMPILER_VERSION = "gs-compiler/1.0.0";
export const NULL_ADMIN = "1nc1nerator11111111111111111111111111111111";
export const SQUADS = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const MAX_TX = 1232;
export const START_DELAY_SEC = 300n;
const VESTING_SEC = 60n;
const MINT_LAMPORTS = 1_461_600n;
const CU_LIMIT_TX1 = 150_000;
const CU_LIMIT_TX2 = 250_000;
const ROLE_RESERVE = 0;
const ROLE_DISTRIBUTOR = 1;
const enc = new TextEncoder();

export interface Spec {
  specVersion: number; compilerVersion: string; chain: string; clusterGenesisHash: Uint8Array; launchId: string; nearContract: string;
  nearBlockHeight: bigint; mode: number; gPub: Uint8Array; mintSeed: string; mintAddress: Uint8Array; tokenProgram: Uint8Array;
  decimals: number; supplyTotal: bigint; name: string; symbol: string; metadataUriSha256: Uint8Array; metadataHash: Uint8Array;
  mintAuthorityNone: boolean; freezeAuthorityNone: boolean; extensionsAllowed: boolean; buckets: Array<[number, bigint]>;
  squadsMultisig: Uint8Array; vaultIndex: number; disclosure: number; merkleRoot: Uint8Array; maxTotalClaim: bigint;
  maxNumNodes: number; clawbackDays: number;
}

export interface Params { jitoProgram: Uint8Array; metadataUri: string; clockTs: bigint }

export interface GenesisCompiled {
  tx1: Uint8Array; tx2: Uint8Array; mint: Uint8Array; supply: bigint; specHash: Uint8Array; timestamps: [bigint, bigint, bigint];
  accounts: { metadata: Uint8Array; reserveAta: Uint8Array; reserveOwner: Uint8Array; distributor: Uint8Array; vault: Uint8Array };
}

class Reader {
  o = 0;
  constructor(readonly b: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error("spec truncated");
    const v = this.b.slice(this.o, this.o + n);
    this.o += n;
    return v;
  }
  dv(n: number): DataView { const t = this.take(n); return new DataView(t.buffer, t.byteOffset, n); }
  u8 = (): number => this.take(1)[0]!;
  u16 = (): number => this.dv(2).getUint16(0, true);
  u32 = (): number => this.dv(4).getUint32(0, true);
  u64 = (): bigint => this.dv(8).getBigUint64(0, true);
  s = (): string => new TextDecoder().decode(this.take(this.u32()));
  k = (): Uint8Array => this.take(32);
}

/** Decodes the borsh GenesisSpec the core stores (`get_genesis_spec`). */
export function decodeSpec(b: Uint8Array): Spec {
  const r = new Reader(b);
  const s: Spec = {
    specVersion: r.u8(), compilerVersion: r.s(), chain: r.s(), clusterGenesisHash: r.k(), launchId: r.s(), nearContract: r.s(),
    nearBlockHeight: r.u64(), mode: r.u8(), gPub: r.k(), mintSeed: r.s(), mintAddress: r.k(), tokenProgram: r.k(), decimals: r.u8(),
    supplyTotal: r.u64(), name: r.s(), symbol: r.s(), metadataUriSha256: r.k(), metadataHash: r.k(), mintAuthorityNone: r.u8() === 1,
    freezeAuthorityNone: r.u8() === 1, extensionsAllowed: r.u8() === 1, buckets: [], squadsMultisig: new Uint8Array(), vaultIndex: 0,
    disclosure: 0, merkleRoot: new Uint8Array(), maxTotalClaim: 0n, maxNumNodes: 0, clawbackDays: 0,
  };
  for (let n = r.u32(); n > 0; n--) s.buckets.push([r.u8(), r.u64()]);
  Object.assign(s, { squadsMultisig: r.k(), vaultIndex: r.u8(), disclosure: r.u8(), merkleRoot: r.k(), maxTotalClaim: r.u64(), maxNumNodes: r.u32(), clawbackDays: r.u16() });
  if (r.o !== b.length) throw new Error("trailing bytes in spec");
  return s;
}

export const specHash = (specBytes: Uint8Array): Uint8Array => sha256(specBytes);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(a, b) === 0;

export function vaultPda(s: Spec): Uint8Array {
  return findPda([enc.encode("multisig"), s.squadsMultisig, enc.encode("vault"), Uint8Array.of(s.vaultIndex)], b58d(SQUADS));
}

function check(s: Spec, p: Params): void {
  if (s.compilerVersion !== COMPILER_VERSION) throw new Error(`compiler version ${s.compilerVersion} is not ${COMPILER_VERSION}`);
  if (s.decimals !== 6 || !s.mintAuthorityNone || !s.freezeAuthorityNone || s.extensionsAllowed) throw new Error("spec must be 6 decimals, both authorities None, no extensions");
  if (!eq(s.tokenProgram, b58d(TOKENKEG))) throw new Error("token program must be Tokenkeg");
  if ([SYSTEM, TOKENKEG, ATA, METAPLEX, COMPUTE_BUDGET].some((x) => eq(p.jitoProgram, b58d(x)))) throw new Error("jito_program must not be a core program");
  if (!eq(sha256(enc.encode(p.metadataUri)), s.metadataUriSha256)) throw new Error("metadata uri does not hash to metadata_uri_sha256");
  if (enc.encode(s.name).length > 32 || enc.encode(s.symbol).length > 10 || enc.encode(p.metadataUri).length > 200) throw new Error("metadata field too long");
  const roles = s.buckets.map(([r]) => r);
  if (roles.some((r, i) => r !== ROLE_RESERVE && r !== ROLE_DISTRIBUTOR || (i > 0 && r <= roles[i - 1]!))) throw new Error(`unsupported bucket roles (LP mirror is not supported by ${COMPILER_VERSION})`);
  const dist = s.buckets.find(([r]) => r === ROLE_DISTRIBUTOR)?.[1] ?? 0n;
  if (s.buckets.reduce((n, [, a]) => n + a, 0n) !== s.supplyTotal || dist !== s.maxTotalClaim) throw new Error("buckets must sum to supply_total and the distributor bucket must equal max_total_claim");
  if (s.supplyTotal >= 2n ** 63n || !/^\d+$/.test(s.launchId) || s.mintSeed !== s.launchId) throw new Error("bad supply, launch id or mint seed");
  if (!eq(createWithSeed(s.gPub, s.mintSeed, TOKENKEG), s.mintAddress)) throw new Error("mint_address is not createWithSeed(g_pub, mint_seed, Tokenkeg)");
}

const computeBudget = (limit: number, price: number): Ix[] => [
  { program: b58d(COMPUTE_BUDGET), accounts: [], data: concat(u8(2), u32(limit)) },
  { program: b58d(COMPUTE_BUDGET), accounts: [], data: concat(u8(3), u64(BigInt(price))) },
];
const anchorDisc = (name: string): Uint8Array => sha256(enc.encode(`global:${name}`)).slice(0, 8);
const str = (x: string): Uint8Array => concat(u32(enc.encode(x).length), enc.encode(x));

export function compileGenesis(specBytes: Uint8Array, p: Params, blockhash: string, price: number): GenesisCompiled {
  const s = decodeSpec(specBytes);
  check(s, p);
  const g = s.gPub, tok = b58d(TOKENKEG), atap = b58d(ATA), sysp = b58d(SYSTEM), mint = s.mintAddress;
  const metaPid = b58d(METAPLEX);
  const metadata = findPda([enc.encode("metadata"), metaPid, mint], metaPid);
  const vaultOwner = vaultPda(s);
  const reserveAta = ataOf(vaultOwner, mint); // also the clawback receiver
  const version = BigInt(s.launchId);
  const distributor = findPda([enc.encode("MerkleDistributor"), mint, u64(version)], p.jitoProgram);
  const vault = ataOf(distributor, mint);
  const start = p.clockTs + START_DELAY_SEC, end = start + VESTING_SEC, claw = start + BigInt(s.clawbackDays) * 86_400n;
  const amount = (role: number): bigint => s.buckets.find(([r]) => r === role)?.[1] ?? 0n;

  const metaData = concat(u8(33), str(s.name), str(s.symbol), str(p.metadataUri), u16(0), Uint8Array.of(0, 0, 0), u8(0), u8(0));
  const tx1: Ix[] = [
    ...computeBudget(CU_LIMIT_TX1, price),
    { program: sysp, accounts: [meta(g, true, true), meta(mint, false, true)], data: concat(u32(3), g, u64(BigInt(enc.encode(s.mintSeed).length)), enc.encode(s.mintSeed), u64(MINT_LAMPORTS), u64(82n), tok) },
    { program: tok, accounts: [meta(mint, false, true)], data: concat(u8(20), u8(s.decimals), g, u8(0)) },
    { program: metaPid, accounts: [meta(metadata, false, true), meta(mint, false, false), meta(g, true, false), meta(g, true, true), meta(g, true, false), meta(sysp, false, false)], data: metaData },
    { program: atap, accounts: [meta(g, true, true), meta(reserveAta, false, true), meta(vaultOwner, false, false), meta(mint, false, false), meta(sysp, false, false), meta(tok, false, false)], data: u8(1) },
  ];
  const newDist = concat(anchorDisc("new_distributor"), u64(version), s.merkleRoot, u64(s.maxTotalClaim), u64(BigInt(s.maxNumNodes)), i64(start), i64(end), i64(claw));
  const mintTo = (dest: Uint8Array, amt: bigint): Ix => ({ program: tok, accounts: [meta(mint, false, true), meta(dest, false, true), meta(g, true, false)], data: concat(u8(7), u64(amt)) });
  // No Solana buyers (zero leaves, zero claim total): nothing to distribute, so no distributor is created.
  const hasDist = s.maxNumNodes > 0 || s.maxTotalClaim > 0n;
  const mints: Ix[] = hasDist ? [mintTo(vault, amount(ROLE_DISTRIBUTOR))] : [];
  if (amount(ROLE_RESERVE) > 0n) mints.push(mintTo(reserveAta, amount(ROLE_RESERVE)));
  const distIxs: Ix[] = !hasDist ? [] : [
    { program: p.jitoProgram, accounts: [meta(distributor, false, true), meta(reserveAta, false, true), meta(mint, false, false), meta(vault, false, true), meta(g, true, true), meta(sysp, false, false), meta(atap, false, false), meta(tok, false, false)], data: newDist },
    { program: p.jitoProgram, accounts: [meta(distributor, false, true), meta(g, true, true), meta(b58d(NULL_ADMIN), false, true)], data: anchorDisc("set_admin") },
  ];
  const tx2: Ix[] = [
    ...computeBudget(CU_LIMIT_TX2, price),
    ...distIxs,
    ...mints,
    { program: tok, accounts: [meta(mint, false, true), meta(g, true, false)], data: Uint8Array.of(6, 0, 0) },
  ];
  return {
    tx1: compileMessage(g, tx1, blockhash), tx2: compileMessage(g, tx2, blockhash), mint, supply: s.supplyTotal,
    specHash: specHash(specBytes), timestamps: [start, end, claw],
    accounts: { metadata, reserveAta, reserveOwner: vaultOwner, distributor, vault },
  };
}

export const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
export const mintBase58 = (b: Uint8Array): string => b58e(b);

const w = {
  s: (x: string): Uint8Array => concat(u32(enc.encode(x).length), enc.encode(x)),
  b: (x: boolean): Uint8Array => u8(x ? 1 : 0),
};

/** Borsh encoding of the core's GenesisSpec (used by the standalone rehearsal core; the real core serves its own bytes). */
export function encodeSpec(s: Spec): Uint8Array {
  return concat(
    u8(s.specVersion), w.s(s.compilerVersion), w.s(s.chain), s.clusterGenesisHash, w.s(s.launchId), w.s(s.nearContract), u64(s.nearBlockHeight),
    u8(s.mode), s.gPub, w.s(s.mintSeed), s.mintAddress, s.tokenProgram, u8(s.decimals), u64(s.supplyTotal), w.s(s.name), w.s(s.symbol),
    s.metadataUriSha256, s.metadataHash, w.b(s.mintAuthorityNone), w.b(s.freezeAuthorityNone), w.b(s.extensionsAllowed),
    u32(s.buckets.length), ...s.buckets.map(([r, a]) => concat(u8(r), u64(a))),
    s.squadsMultisig, u8(s.vaultIndex), u8(s.disclosure), s.merkleRoot, u64(s.maxTotalClaim), u32(s.maxNumNodes), u16(s.clawbackDays),
  );
}
