import { compileGenesis, decodeSpec, hex, START_DELAY_SEC, type GenesisCompiled, type Params } from "./compile.js";
import type { MintView } from "./mintcheck.js";
import { TOKENKEG } from "./solana-bytes.js";

/** One confirmed transaction from G's history: its signature and the legacy message G signed. */
export interface ChainTx { sig: string; blockhash: string; message: Uint8Array }

export interface Recovered { sigs: [string, string]; params: Params; blockhash: string; compiled: GenesisCompiled }

/** An Anchor program checks its compiled-in declared id: a copy deployed at another address fails every call with
 *  DeclaredProgramIdMismatch (error 4100), which aborted launch 3. The ELF must contain the 32 id bytes of the address it runs at. */
export function programDataDeclaresId(programData: Uint8Array, programId: Uint8Array): boolean {
  return Buffer.from(programData).indexOf(Buffer.from(programId)) >= 0;
}

/** The distributor start time sits right after (merkle root, max_total_claim, max_num_nodes) in tx2's new_distributor data, so the
 *  clock a finished ceremony used can be read back from the chain. Null when the message has no distributor instruction. */
export function recoverClockTs(specBytes: Uint8Array, message: Uint8Array): bigint | null {
  const root = decodeSpec(specBytes).merkleRoot;
  const at = Buffer.from(message).indexOf(Buffer.from(root));
  if (at < 0 || at + 32 + 16 + 8 > message.length) return null;
  const start = new DataView(message.buffer, message.byteOffset, message.length).getBigInt64(at + 32 + 16, true);
  return BigInt(start) - START_DELAY_SEC;
}

/** Finds the ceremony's tx1 and tx2 among G's transactions: each must equal compile(spec, its own blockhash, price) byte for byte,
 *  with the clock the distributor start implies. Throws a message that says what is missing. */
export function matchCeremonyTxs(txs: ChainTx[], specBytes: Uint8Array, base: Omit<Params, "clockTs">, price: number): Recovered {
  const hasDist = (() => { const s = decodeSpec(specBytes); return s.maxNumNodes > 0 || s.maxTotalClaim > 0n; })();
  const clock = txs.map((t) => recoverClockTs(specBytes, t.message)).find((c) => c !== null) ?? null;
  if (hasDist && clock === null) throw new Error("existing mint: no transaction of G carries the committed distributor (merkle root); cannot adopt it");
  const params: Params = { ...base, clockTs: clock ?? 0n };
  const found: Partial<Record<"tx1" | "tx2", { tx: ChainTx; compiled: GenesisCompiled }>> = {};
  for (const tx of txs) {
    const compiled = compileGenesis(specBytes, params, tx.blockhash, price);
    for (const which of ["tx1", "tx2"] as const) if (Buffer.compare(compiled[which], tx.message) === 0) found[which] = { tx, compiled };
  }
  const { tx1, tx2 } = found;
  if (!tx1 || !tx2) throw new Error(`existing mint cannot be adopted: G's history lacks the committed ${!tx1 ? "tx1 (create)" : "tx2 (seal)"} (compile(spec, blockhash, price) matched none of ${txs.length} transactions)`);
  return { sigs: [tx1.tx.sig, tx2.tx.sig], params, blockhash: tx2.tx.blockhash, compiled: tx2.compiled };
}

/** A sealed mint that already exists for the committed address is adopted only when it has exactly the properties the spec commits to. */
export function checkAdoptable(view: MintView, specBytes: Uint8Array, compiled: GenesisCompiled): void {
  const s = decodeSpec(specBytes);
  const bad: string[] = [];
  if (view.owner !== TOKENKEG) bad.push(`owner ${view.owner}`);
  if (view.space !== 82) bad.push(`space ${view.space}`);
  if (!view.initialized) bad.push("not initialized");
  if (view.mintAuthority !== null) bad.push("mint authority not None");
  if (view.freezeAuthority !== null) bad.push("freeze authority not None");
  if (view.decimals !== s.decimals) bad.push(`decimals ${view.decimals} != ${s.decimals}`);
  if (view.supply !== s.supplyTotal) bad.push(`supply ${view.supply} != ${s.supplyTotal}`);
  if (hex(compiled.mint) !== hex(s.mintAddress)) bad.push("mint address differs from the committed spec");
  if (bad.length) throw new Error(`existing mint does not match the committed spec: ${bad.join("; ")}. Do not confirm; the owner should abort this genesis`);
}
