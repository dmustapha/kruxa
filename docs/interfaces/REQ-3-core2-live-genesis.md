# REQ-3: what A2 needs from A1 to run the live core2 genesis (A2 to A1)

Superseded: `REQ-1.md` (my old spec encoding) is replaced by the core's own `GenesisSpec` (docs/interfaces/REQ-1-genesis-relayer.md). The compiler now
decodes the core's borsh bytes (`relayer/src/compile.ts`, `tools/genesis/ref/compile.py`), and `fixtures/vectors/genesis-*.json` carry a `spec_hex`
and `spec_hash` produced by `kruxa-logic` itself (`tools/genesis/specvec`), so Rust, Python and TypeScript agree on `genesis_spec_hash`.

## Blocking on core2 (testnet)
1. **Token accounts.** `create_trial` needs `<symbol>.factory.kxa1-owner-1203.testnet` to exist (the mock factory does not create it). Please deploy
   `mock_ft` (owner = `core2.kxa1-owner-1203.testnet`, total supply = `total_supply_whole * 1e6` base units) at these six accounts, about 1.6 NEAR of
   storage each: `krxg1`, `krxg2`, `krxg3`, `krxg4`, `krxg5`, `krxg6` (F1 PASS, FAIL, F0 PASS x3 and one spare). Symbols are `KRXG1`..`KRXG6`; supply
   1,000,000,000 whole tokens (1e15 base units), so `total_supply = "1000000000000000"`.
2. **NEAR for the relayer account** `7218da57019c05386280b3a4196e7654279e32c66e129889e17a653fc229cc85` (now about 0.99 NEAR): `create_trial` costs
   0.42 NEAR per launch and each of the 12 mock Solana buyers costs about 0.02 NEAR of gas. Please send **3 NEAR**.
3. If you prefer to create the launches yourself: run `relayer/src/launch-core2.ts` (see its header) or tell me the launch ids that are settled PASS and
   the FAIL one; my tool only needs `genesis_relayer` (already set to my account, verified via `get_config`).

## Blocking on devnet SOL
The Jito distributor is not deployed on devnet. `scripts/genesis-devnet-setup.sh` deploys a labelled copy and needs about 4.34 SOL of rent; the
relayer key `8yePW2xxVhQfsSb5RX7h46gpy7Jf7KYZi9GUMkPdyUKa` holds 3.83 SOL after the Squads and ceremony runs. Please fund **+1.5 SOL** (4.34 for the
program plus about 0.15 for ceremonies). Until then the devnet ceremonies run in the no-distributor variant (zero Solana buyers).

## Findings for core and the docs
* F0 `mint_pubkey_f0` is derived from the NEAR account that CALLS `v1.signer`. Rehearsals call it from the relayer account, so the path predecessor
  is the relayer account, not `core2`. The production path (contract-initiated `sign_genesis`) is still Task 4.6 and has no core code yet.
* `new_distributor` needs `start_ts`/`end_ts` strictly in the future when tx2 lands. The public compiler derives them as `clock_ts + 300 s`, `+ 60 s`;
  `clock_ts` is a public compile parameter, `clawback_ts = start + clawback_days * 86400`.
* A system account cannot end a transaction with 0 < lamports < 890,880, so G keeps exactly 890,880 lamports of dust. `verify` C16 therefore allows
  `<= 895,880`, not `<= 5,000` (S1-D C16 needs a sweep instruction to reach 0; not built).
* The Metaplex creation cost differs between a local validator and devnet by 1,974,400 lamports (local lacks the on-chain fee configuration).
