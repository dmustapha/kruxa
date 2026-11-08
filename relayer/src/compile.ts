/** TypeScript genesis compiler. Python (tools/genesis/ref/compile.py) is the reference; a mismatch is fixed HERE. */
import {
  ATA, COMPUTE_BUDGET, METAPLEX, SYSTEM, TOKENKEG, ataOf, b58d, b58e, compileMessage, concat, createWithSeed, findPda,
  i64, meta, sha256, str, u16, u32, u64, u8, type Ix,
} from "./solana-bytes.js";

export const NULL_ADMIN = "1nc1nerator11111111111111111111111111111111";
export const MAX_TX = 1232;
const CU_LIMIT_TX1 = 150_000;
const CU_LIMIT_TX2 = 250_000;
const SPEC_DOMAIN = new TextEncoder().encode("kruxa:genesis-spec:v1");

export interface GenesisSpec {
  launchId: bigint; gPub: Uint8Array; decimals: number; name: string; symbol: string; metadataUri: string;
  mintLamports: bigint; reserveOwner: Uint8Array; lpOwner: Uint8Array; clawbackOwner: Uint8Array;
  reserveAmount: bigint; lpAmount: bigint; jitoProgram: Uint8Array; merkleRoot: Uint8Array;
  maxTotalClaim: bigint; maxNumNodes: bigint; startTs: bigint; endTs: bigint; clawbackTs: bigint;
}

export interface GenesisSpecJson {
  launch_id: string; g_pub: string; decimals: number; name: string; symbol: string; metadata_uri: string;
  mint_lamports: string; reserve_owner: string; lp_owner: string; clawback_owner: string;
  reserve_amount: string; lp_amount: string; jito_program: string; merkle_root: string;
  max_total_claim: string; max_num_nodes: string; start_ts: string; end_ts: string; clawback_ts: string;
}

export interface GenesisCompiled {
  tx1: Uint8Array; tx2: Uint8Array; mint: Uint8Array; supply: bigint; specHash: Uint8Array;
  accounts: { metadata: Uint8Array; reserveAta: Uint8Array; lpAta: Uint8Array; clawbackAta: Uint8Array; distributor: Uint8Array; vault: Uint8Array };
}

export function specFromJson(j: GenesisSpecJson): GenesisSpec {
  return {
    launchId: BigInt(j.launch_id), gPub: b58d(j.g_pub), decimals: j.decimals, name: j.name, symbol: j.symbol,
    metadataUri: j.metadata_uri, mintLamports: BigInt(j.mint_lamports), reserveOwner: b58d(j.reserve_owner),
    lpOwner: b58d(j.lp_owner), clawbackOwner: b58d(j.clawback_owner), reserveAmount: BigInt(j.reserve_amount),
    lpAmount: BigInt(j.lp_amount), jitoProgram: b58d(j.jito_program), merkleRoot: Uint8Array.from(Buffer.from(j.merkle_root, "hex")),
    maxTotalClaim: BigInt(j.max_total_claim), maxNumNodes: BigInt(j.max_num_nodes), startTs: BigInt(j.start_ts),
    endTs: BigInt(j.end_ts), clawbackTs: BigInt(j.clawback_ts),
  };
}

export function specBytes(s: GenesisSpec): Uint8Array {
  return concat(
    Uint8Array.of(1, s.decimals), u64(s.launchId), s.gPub, str(s.name), str(s.symbol), str(s.metadataUri),
    u64(s.mintLamports), s.reserveOwner, s.lpOwner, s.clawbackOwner, u64(s.reserveAmount), u64(s.lpAmount),
    s.jitoProgram, s.merkleRoot, u64(s.maxTotalClaim), u64(s.maxNumNodes), i64(s.startTs), i64(s.endTs), i64(s.clawbackTs),
  );
}

export const specHash = (s: GenesisSpec): Uint8Array => sha256(SPEC_DOMAIN, specBytes(s));

function check(s: GenesisSpec): void {
  const eq = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
  if (s.decimals !== 6) throw new Error("decimals must be 6");
  if ([SYSTEM, TOKENKEG, ATA, METAPLEX].some((p) => eq(s.jitoProgram, b58d(p)))) throw new Error("jito_program must not be a core program");
  const len = (x: string) => new TextEncoder().encode(x).length;
  if (len(s.name) > 32 || len(s.symbol) > 10 || len(s.metadataUri) > 200) throw new Error("metadata field too long");
  if (s.reserveAmount + s.lpAmount + s.maxTotalClaim >= 2n ** 63n) throw new Error("supply overflow");
  if (s.gPub.length !== 32 || s.merkleRoot.length !== 32) throw new Error("bad key length");
  if (!(0n <= s.startTs && s.startTs <= s.endTs && s.endTs <= s.clawbackTs)) throw new Error("timestamps must satisfy start <= end <= clawback");
}

const computeBudget = (limit: number, price: number): Ix[] => [
  { program: b58d(COMPUTE_BUDGET), accounts: [], data: concat(u8(2), u32(limit)) },
  { program: b58d(COMPUTE_BUDGET), accounts: [], data: concat(u8(3), u64(BigInt(price))) },
];

const anchorDisc = (name: string): Uint8Array => sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);

export function compileGenesis(s: GenesisSpec, blockhash: string, price: number): GenesisCompiled {
  check(s);
  const g = s.gPub, tok = b58d(TOKENKEG), atap = b58d(ATA), sysp = b58d(SYSTEM);
  const seed = `kruxa:${s.launchId}`;
  const mint = createWithSeed(g, seed, TOKENKEG);
  const metaPid = b58d(METAPLEX);
  const metadata = findPda([new TextEncoder().encode("metadata"), metaPid, mint], metaPid);
  const [reserveAta, lpAta, clawbackAta] = [s.reserveOwner, s.lpOwner, s.clawbackOwner].map((o) => ataOf(o, mint)) as [Uint8Array, Uint8Array, Uint8Array];
  const version = s.launchId;
  const distributor = findPda([new TextEncoder().encode("MerkleDistributor"), mint, u64(version)], s.jitoProgram);
  const vault = ataOf(distributor, mint);

  const createAta = (owner: Uint8Array, a: Uint8Array): Ix => ({
    program: atap,
    accounts: [meta(g, true, true), meta(a, false, true), meta(owner, false, false), meta(mint, false, false), meta(sysp, false, false), meta(tok, false, false)],
    data: u8(1),
  });
  const metaData = concat(u8(33), str(s.name), str(s.symbol), str(s.metadataUri), u16(0), Uint8Array.of(0, 0, 0), u8(0), u8(0));
  const tx1: Ix[] = [
    ...computeBudget(CU_LIMIT_TX1, price),
    { program: sysp, accounts: [meta(g, true, true), meta(mint, false, true)], data: concat(u32(3), g, u64(BigInt(seed.length)), new TextEncoder().encode(seed), u64(s.mintLamports), u64(82n), tok) },
    { program: tok, accounts: [meta(mint, false, true)], data: concat(u8(20), u8(s.decimals), g, u8(0)) },
    { program: metaPid, accounts: [meta(metadata, false, true), meta(mint, false, false), meta(g, true, false), meta(g, true, true), meta(g, true, false), meta(sysp, false, false)], data: metaData },
    createAta(s.reserveOwner, reserveAta), createAta(s.lpOwner, lpAta), createAta(s.clawbackOwner, clawbackAta),
  ];
  const newDist = concat(anchorDisc("new_distributor"), u64(version), s.merkleRoot, u64(s.maxTotalClaim), u64(s.maxNumNodes), i64(s.startTs), i64(s.endTs), i64(s.clawbackTs));
  const mintTo = (dest: Uint8Array, amount: bigint): Ix => ({ program: tok, accounts: [meta(mint, false, true), meta(dest, false, true), meta(g, true, false)], data: concat(u8(7), u64(amount)) });
  const tx2: Ix[] = [
    ...computeBudget(CU_LIMIT_TX2, price),
    { program: s.jitoProgram, accounts: [meta(distributor, false, true), meta(clawbackAta, false, true), meta(mint, false, false), meta(vault, false, true), meta(g, true, true), meta(sysp, false, false), meta(atap, false, false), meta(tok, false, false)], data: newDist },
    { program: s.jitoProgram, accounts: [meta(distributor, false, true), meta(g, true, true), meta(b58d(NULL_ADMIN), false, true)], data: anchorDisc("set_admin") },
    mintTo(vault, s.maxTotalClaim), mintTo(reserveAta, s.reserveAmount), mintTo(lpAta, s.lpAmount),
    { program: tok, accounts: [meta(mint, false, true), meta(g, true, false)], data: Uint8Array.of(6, 0, 0) },
  ];
  return {
    tx1: compileMessage(g, tx1, blockhash), tx2: compileMessage(g, tx2, blockhash), mint,
    supply: s.maxTotalClaim + s.reserveAmount + s.lpAmount, specHash: specHash(s),
    accounts: { metadata, reserveAta, lpAta, clawbackAta, distributor, vault },
  };
}

export const mintAddress = (gPub: Uint8Array, launchId: bigint): string => b58e(createWithSeed(gPub, `kruxa:${launchId}`, TOKENKEG));

export function specToJson(s: GenesisSpec): GenesisSpecJson {
  return {
    launch_id: s.launchId.toString(), g_pub: b58e(s.gPub), decimals: s.decimals, name: s.name, symbol: s.symbol,
    metadata_uri: s.metadataUri, mint_lamports: s.mintLamports.toString(), reserve_owner: b58e(s.reserveOwner),
    lp_owner: b58e(s.lpOwner), clawback_owner: b58e(s.clawbackOwner), reserve_amount: s.reserveAmount.toString(),
    lp_amount: s.lpAmount.toString(), jito_program: b58e(s.jitoProgram), merkle_root: Buffer.from(s.merkleRoot).toString("hex"),
    max_total_claim: s.maxTotalClaim.toString(), max_num_nodes: s.maxNumNodes.toString(), start_ts: s.startTs.toString(),
    end_ts: s.endTs.toString(), clawback_ts: s.clawbackTs.toString(),
  };
}
