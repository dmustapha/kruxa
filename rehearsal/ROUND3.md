# Round 3: F0 and the R_GAS guard on the exact deployed wasm (2026-11-10)

NEAR TESTNET and Solana DEVNET only, play money, throwaway keys. Closes PD-18. Details per row: `rehearsal/LOG.md` (rows R3-1 to R3-5).

## Result per step

| Step | Result | Evidence |
|---|---|---|
| 1 deployed wasm and invariants | PASS. `view_code` of `core3.kxi-root-1108.testnet` sha256 `e85198ed37c2aa1d6cd5f18571f5e023eed391108ca8f22edc8599ac390e65ac` (equal to the final wasm, equal to `artifacts/SHA256SUMS`). `get_invariants` all_ok true for launches 2, 6, 8 and 9. | `evidence/testnet-core3/verify-9-f0.txt` (CODE line MATCH) |
| 2 R_GAS guard live | PASS. `create_trial` for KXCI with 150 Tgas from creator-a: refused `Smart contract panicked: R_GAS: attach at least 250 Tgas to create_trial`, tx `2CpPLzn8QrWhNur3cx84ZtKwr7WjGyYUWcmwJ8vNstJs`. No launch was created (next free launch id 9 before and after), the 0.42125 NEAR deposit came back (balance moved by 0.0002 NEAR of gas only). The same creator then called `create_trial` with 300 Tgas and it worked (launch 9 Open, tx `4dR4h6sE7UfdKK9YYLWvY4ASdhswgf5MaNL7Gh1CJ6m9`), so the refusal did NOT lock the creator (contrast round 2 launch 7, 150 Tgas, stuck in Creating). | `evidence/testnet-core3/rgas-probe.json`, `txlog.jsonl` |
| 3 launch 9 (KXCI) | PASS. creator-a, 12 Solana buyers, 360 USDC, F0 plan. Keeper: settle `EuRNULMjV4Mzq8KYfEPo1fTSpVdu2w2T16Rt78UqEYmN`, pages, sweep, consolidate `7Ms7t5uEnpKjgNkBuKoytipDdD5cATtrRyjrhrRtQsUc`, pay_launch_fee `4A5UautV2SKsTziuLrN8nM3swgZFpmZBgerQssXw6hwH`; pay_relay_fees `R_NOTHING_FREE` (relay fee 0, expected). Final status Passed, positions_unsettled 0. | `evidence/testnet-core3/keeper-9.log`, `launches.json` (row I) |
| 4 F0 ceremony | PASS. `register_f0_message` plus `sign_genesis` x2 (predecessor `core3.kxi-root-1108.testnet`, path `kruxa:genesis:9`, sign txs `HqF5zegek9UBJV4x5xweMbyDFKKPuRrBJuSzfecmbSCE` and `EB7KDef4c9s3QKXLfiCM47EvdupXk724gabtqrhF7BjV`), mint `7unMFFxMcyMrQa75D3WJUW8qqV4QPE9naj4uCo4NMgf5`, Solana tx1 `5F1W4414sffm3SkdryJt3TTt6BY5JTLaq1MDav89VkhcQcCkozWGa7o9BCzhrRvYsnJE1vWmEHV975RfjABq3krL`, tx2 `eeXidaeUGbhus2WxEQ22qqzvpN3jbAh2yFc1kZMm86MVEjED5qaLKRXAJkjvMocfpVa5V6pugm4Du9gAT6Q7aXK`, `confirm_genesis` ok (core get_genesis Confirmed, 12 leaves), merkle root matches the core, claim ok 54166666666666, distributor admin null, mint authority null, freeze authority null, G ends 890880 lamports. | `evidence/genesis/core3-f0-devnet-launch9.json`, `.log`, `evidence/genesis/core3/genesis-9.json` |
| 5 verify | PASS. `KRUXA_CONTRACT=core3.kxi-root-1108.testnet KRUXA_GENESIS_PREFIX=evidence/genesis/core3/genesis- ./scripts/verify.sh 9`: exit 0 (21 passed, 7 skipped, KEYS 1 full-access key, CODE line MATCH `e85198ed...`). `--tamper-all`: exit 2, 19 MISMATCH lines. | `evidence/testnet-core3/verify-9-f0.txt`, `verify-9-tamper-all.txt` |

## Notes

1. The first R_GAS probe attempt did not reach the contract: the creator had 0.5656 NEAR and the call needed 0.5722 (client-side balance error, tx `BND3nCKuux8AEyVe23sivUeKNgVEcvTSWtyvPu9dMSAE` is only the attempt id in the txlog). After a 0.25 NEAR top-up the probe ran and gave the R_GAS refusal. Different cause, not a repeat.
2. The genesis driver needs `tools/squads/node_modules` (static import of `@sqds/multisig` in `tools/squads/vault.ts`). The worktree had none; a TEMPORARY symlink to an existing install was used and removed. Along with the temporary `relayer/node_modules`, `scripts/node_modules` and `target` symlinks: none committed, all removed.
3. `KXI_RESERVE_NEAR=1` was set for seed.mjs (its default reserve is 2; the task's floor is 1 NEAR on the root).

## Balances (NEAR)

| Account | Before | After |
|---|---|---|
| kxi-root-1108.testnet (root) | 2.256 | 1.414 (never below 1.0; low point about 1.29 during the seed) |
| core3 | 9.851 | 10.213 |
| market3 | 2.798 | 2.798 |
| keeper | 0.723 | 0.397 |
| creator-a | 0.566 | 0.393 |
| creator-b / probe2 / buyer (1108) | 0.242 / 0.430 / 0.353 | 0.060 each (swept to the root) |
| factory.kxi-root-0811 | 1.153 | 1.153 |
| kxci.factory.kxi-root-0811 (new mock-FT token account of launch 9) | n/a | 1.799 |
| Solana devnet relayer | see `evidence/genesis/core3-f0-devnet-launch9.log` | |

NEAR moved only between our own throwaway accounts (txs in `evidence/testnet-core3/txlog.jsonl`, rows with "round 3"). Nothing was deleted.

## New or changed files

`scripts/core-testnet/rgas-probe.mjs`, `sweep-some.mjs`; `seed.mjs` (spec I), `scripts/seed-demo.sh` (accepts I); evidence under `evidence/testnet-core3/` and `evidence/genesis/`.

## Process hygiene

Seed, keeper, genesis driver and verify runs all ended; `ps` shows none of them running.
