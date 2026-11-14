# Core change: lower the production launch bar to $100

Owner ruling: a production (`ladder` profile) launch may pass with $100 of buyer commitments instead of $350.

## What changed

`crates/kruxa-logic/src/rules.rs`, `Rules::ladder()` only:

| Constant | Before | After |
|---|---|---|
| `min_soft_abs` | 350 * USDC | 100 * USDC |
| `min_buy_abs` | 20 * USDC | 10 * USDC |

Unchanged on purpose: `funders_min` 10, `min_soft_pct_bps` 2000, `min_hard_cap` $500, `min_buy_divisor` 500, and `demo_clock()` (relaxes time only).

## Why these numbers fit together

- `check_raise` needs `soft_cap >= max(min_soft_abs, 20% of hard_cap)`. A $100 soft cap therefore needs `hard_cap <= $500`, which is the minimum hard cap. A $1,000 hard cap still needs a $200 soft cap.
- `min_buy >= max(min_buy_abs, ceil(hard_cap / 500))`. At a $500 hard cap the divisor term is $1, so $10 is the floor.
- R_PASSABLE: `min_funders * min_buy <= soft_cap`. 10 funders x $10 = $100 fits exactly; 11 funders x $10 does not.

The lowest legal production launch is therefore: hard cap $500, soft cap $100, min buy $10, 10 funders.

## Thin-pool consequence

At a $100 raise (sale 6500 bps, LP 2500 bps), from `settle::launch_fee` and `allocate`:

- Launch fee is `min(max_fee, 3% of A, max(1.5% of A, $10))`. The $10 minimum would be 10% of $100, but the 3% ceiling binds, so the fee is **$3.00 (3%)**, not $10. The $10 minimum only bites above roughly a $333 raise.
- LP quote is `A * lp_bps / sale_bps` = **$38.46** (38,461,538 micro-USDC). That is the whole pool depth at open.
- The creator stream receives the remainder, about $58.54.

Expect very high slippage on a $38 pool; this bar is for plumbing and brand-token proofs, not for deep markets.

## Files changed

- `crates/kruxa-logic/src/rules.rs`: the two constants; `one_failing_case_per_code` boundary cases now use 100 USDC - 1 and 10 USDC - 1; new tests `lowest_bar_*` (valid launch, one micro-USDC below refused for R_SOFT_CAP and R_MIN_BUY, $1,000 hard cap with $100 soft cap refused, R_PASSABLE exactness).
- `app/lib/charter/rules.ts`: `minSoftAbs`, `minBuyAbs` mirror; `rules.test.ts` cases and a new `lowest launch bar` block.
- `app/lib/charter/explain.ts`: R_SOFT_CAP sentence ($100).
- `app/content/docs/facts.ts`: `softCapFloorUsdc` 100, `minBuyUsdc` 10 (drives the docs pages); `app/content/docs/pages/buyers.ts` withdrawal-fee percentage at the minimum buy (0.30%); `app/components/docs/facts.test.ts` matching assertion.
- `scripts/mainnet/kruxa-trial-params.json` and `scripts/mainnet/mainnet.test.mjs`: hard cap 500000000, soft cap 100000000, min buy 10000000, 10 funders.
- `ARCHITECTURE.md`, `docs/PRD.md`, `docs/INVARIANTS.md` (D-28 note), `docs/runbooks/genesis-round-mainnet.md`: rule copies and prose.

## Files that still name the old numbers (left on purpose)

- Parameters that are still legal above the new floors: `TrialParams::example` ($1,000 / $350 / $20), `app/lib/charter/presets.ts`, `fixtures/*.json`, `fixtures/vectors/*`, `CLAIMS.md` (explicit params), `tests/tests/*`, `tools/*`, `services/*` fixtures and tests, `app/lib/charter/scenarios.test.ts`.
- Recorded evidence under `evidence/` and `swarm/runs/` (deploy.json files embed the old `Rules` snapshot of the deployed wasm; they are history).
- `docs/runbooks/testnet-core2.md` and `ARCHITECTURE.md` historical test listings: describe the earlier testnet build.
- `ARCHITECTURE.md` `TrialParams::example` copy and the sandbox test listings.
- `app/content/docs/pages/fees.ts`: "0.15% at a $20 amount" is a generic example amount.

## Deployed wasm

The floors live in `Rules::ladder()` compiled into the core wasm. Any already deployed core keeps $350 / $20 until redeployed; the reproducible-build hash changes.
