# REQ-1: genesis spec, hashes and ceremony fields (from A2 to A1, Task 4.4)

Status: request. Source of truth for bytes: `tools/genesis/ref/compile.py` (Python reference); `relayer/src/compile.ts` is byte-identical on
`fixtures/vectors/genesis-a.json` and `genesis-b.json` (`cd relayer && npx vitest run`). Rust must reproduce `spec_hash` from the same vectors.

## 1. `GenesisSpec` canonical bytes and `genesis_spec_hash`
`genesis_spec_hash = sha256("kruxa:genesis-spec:v1" || spec_bytes)` where `spec_bytes` is, in order: `u8 version=1`, `u8 decimals (=6)`,
`u64 launch_id`, `[u8;32] g_pub`, `string name`, `string symbol`, `string metadata_uri` (each `u32 LE length || UTF-8`), `u64 mint_lamports`,
`[u8;32] reserve_owner`, `[u8;32] lp_owner`, `[u8;32] clawback_owner`, `u64 reserve_amount`, `u64 lp_amount`, `[u8;32] jito_program`,
`[u8;32] merkle_root`, `u64 max_total_claim`, `u64 max_num_nodes`, `i64 start_ts`, `i64 end_ts`, `i64 clawback_ts`. All integers little endian.
The contract derives every field except `g_pub` (F1: relayer supplies it; F0: derived from the signer, no free input).
Limits the compiler enforces: decimals 6, name <= 32 bytes, symbol <= 10, uri <= 200, `reserve+lp+max_total_claim < 2^63`,
`start_ts <= end_ts <= clawback_ts`, `jito_program` not a core program. `mint_lamports` = 1,461,600 (rent for 82 bytes).

## 2. Timestamps (measured against the real Jito binary)
`new_distributor` rejects `start_ts >= end_ts` (StartTimestampAfterEnd) AND any timestamp not in the future at execution time
(TimestampsNotInFuture). So `start_ts` must be strictly after the time tx2 lands: use `commit time + 150 s` for F0 and `+75 s` for F1;
`end_ts > start_ts`; `clawback_ts` = start + 90 days. [VERIFIED on a local validator with the mainnet binary.]

## 3. Derived values the contract may store or check
* mint `M = createWithSeed(base=g_pub, seed="kruxa:<launch_id>", owner=Tokenkeg)`; no private key exists.
* Merkle: leaf = `sha256(0x00 || sha256(claimant32 || unlocked u64 LE || locked u64 LE))`; node = `sha256(0x01 || min(a,b) || max(a,b))`;
  leaves sorted ascending by claimant bytes, odd node promoted. `fixtures/vectors/merkle-a.json` is the golden vector;
  [VERIFIED] a claim with a proof built this way succeeds against the deployed Jito program (local validator).
* `ceremony_hash = sha256(genesis_spec_hash || bs58decode(sig_tx1) || bs58decode(sig_tx2))`.
* Distributor admin is set to the incinerator `1nc1nerator11111111111111111111111111111111` (no known key) in tx2 (`NULL_ADMIN`).
* `max_num_nodes` = leaf count; `max_total_claim` = sum of leaf amounts; Solana supply = `max_total_claim + reserve_amount + lp_amount`.

## 4. What `confirm_genesis` receives
`(launch_id, mint, [sig_tx1, sig_tx2], slot, ceremony_hash)`. The relayer calls it after reading the mint back and asserting both authorities None
and size 82. Refusal codes the relayer's `MockCore` models: `R_GENESIS_STATE` (launch not PASS), `R_GENESIS_ALREADY`, `R_GENESIS_AUTH`.
The relayer's only free input is `g_pub` (F1). FAIL launch: `commit_genesis` returns `R_GENESIS_STATE` and no mint account is ever created.

## 5. Cost the platform budget must cover (measured)
G needs exactly 27,306,000 lamports at price 1000 micro-lamports/CU (rent for mint, metadata, 3 bucket ATAs, vault ATA, distributor; the Metaplex
0.01 SOL creation fee; tx fees). `relayer/src/ceremony.ts::genesisCostLamports` funds G with exactly this so G ends at 0 lamports (verify C16).
[VERIFIED local; devnet confirmation pending funding.]
