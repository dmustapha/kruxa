# Rule constants: ruled versus open (Task 1.1 sweep, 2026-11-08)

Source of each value: `crates/kruxa-logic/src/rules.rs` (`Rules::ladder()`, `FeeTerms::standard()`) and `contracts/core/src/lib.rs`.
The sweep found no mismatch against the rulings, so no constant was changed (no change order CO-7 needed). Ruled values are pinned by the unit test `ruled_constants_match_the_rulings`.

## Ruled (match the rulings)
| Constant | Value as built | Ruling |
|---|---|---|
| per-launch hard cap ceiling (`max_hard_cap`) | 1_000_000_000 micro ($1,000) | 2026-11-07 caps, DECISIONS-PACK1 row 28 |
| global cap (`GLOBAL_CAP_USDC`, core) | 3_000_000_000 micro ($3,000) | same |
| backer bonus vest (`backer_vest_days`) | 30 days | 2026-11-07 |
| fee split creator/platform/holders/LP/referral | 5_000/1_500/1_500/1_000/1_000 bps | DN-15, R-46, CO-5 D-4 |
| platform share (`platform_bps`, floor equals value) | 1_500 | DN-15, CO-5 D-4 |
| cap-raise timelock (`CAP_TIMELOCK_NS`, core) | 7 days | "raising caps is timelocked"; W1-SCOPE section 7 says 7-day |
| FROZEN auto-expiry (`FREEZE_MAX_NS`, core) | 7 days | W1-DC-9 |

Clarification (not a change): the 48 h timelock in the rulings (R-GR-TIME) is the Squads reserve vault on Solana (Phase 4, Task 4.8), not a contract constant. The core contract has no 48 h timelock; its cap-raise delay is 7 days. If Dami intended a 48 h cap-raise delay he must rule it, because that would change the 7-day wording in W1-SCOPE section 7.

## Open (built as stated, not ruled; do not change here)
| ID | Constant | Value as built | Status |
|---|---|---|---|
| DN-1 | relay fee ceiling (`max_relay_fee_abs`, `max_relay_fee_bps`) | 500_000 micro ($0.50) and 500 bps (5%) | open |
| DN-2 | oversubscription ceiling (`max_oversub_bps`) | 20_000 bps (2x) | open |
| DN-4 | storage payer | creator bond (`bond_required`) | open |
| DN-5 | launch-fee storage reserve | none taken | open |
