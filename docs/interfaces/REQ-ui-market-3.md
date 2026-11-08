# REQ-ui-market-3 (from U2, instant launch token page)

Readers: indexer owner (I), U1, docs agent. Builds on REQ-ui-market.md and REQ-ui-market-2.md. Branch `ws/market-ui3`. Sources: CHANGE-ORDER-7 4.3, INSTANT-ABI 1.0.0 (draft), MARKET-ABI 1.1.0, OpenAPI 1.1.0 (1.2.0 was not available when this was written).

## For I (all optional; the page shows unknown when absent)
- `launch.mode` (`trial` | `instant`) on LaunchSummary and `pool.mode`, `pool.creator` on PoolInfo. Fallback in the UI: `pool.mode`, then the id range (`launch_id >= 1_000_000_000`). The UI never reads mode from creator-supplied text.
- Instant launch statuses on `launch.status`: the UI recognises `launching`, `trading`, and the failed set `creation_failed`, `abandoned`, `aborted`, `launch_failed`. Please confirm the exact strings.
- `TokenPage.instant` (so the page does not need the launcher RPC): `{ status, n_alloc, n_pool, creator_alloc_bps, cliff_days, vest_days, seed_q, launch_fee, pool_seed_q, opened_at_ns, seeded_at_ns, alloc_claimed, declared_wallets[], vesting? { recipient, total, unlocked, claimed, claimable, cliff_end_ns, vest_end_ns } }`. Without it the page reads the launcher views `get_instant` and `get_vesting` over RPC (`NEXT_PUBLIC_INSTANT_ACCOUNT`, default `instant.kruxa.testnet`), and otherwise shows the schedule as an estimate computed from `n_alloc`, cliff and vest days with the contract formula.
- `GET /api/launch/{id}` for instant ids with `timeline` events `instant_created`, `instant_seeded`, `instant_opened` (receipts for the 3-step strip).
- Market `get_config` is read over RPC for `max_instant_reserve_q` and `instant_q` (the instant sub-cap). If you fold them into `/api/health` or `/api/token`, the UI can drop the RPC read.

## Spec points to settle (CO-7 vs the coordinator brief)
- CO-7 4.3 says the tile "authorities null" must NOT appear for an instant token; the brief listed "null authorities" under Contract facts. The page follows CO-7: no authorities tile, and the Contract facts row "Mint and freeze authority" reads `unknown` with the reason (no Solana mint, no mint method in the launcher).
- OpenAPI 1.1.0 `Genesis.stage` is `none|pending|committed|confirmed`. The U2 trial genesis stepper previously assumed other stage names; this branch fixes it to the real enum (mint step is done only when `confirmed` and both authorities are logged `null`).

## For U1
- Mode badge and the non-dismissible notice are exported: `ModeBadge`, `InstantNotice` from `@/components/market/index`; labels and notice text from `@/lib/market/index` (`MODE_LABEL`, `INSTANT_NOTICE_TITLE`, `RISK_PAGE = /legal/risk`). Feed cards and portfolio rows can reuse them so the wording stays identical.
- The notice links to `/legal/risk`; that page must exist.
- `claim_vested` is built by `buildClaimVestedTx` in `@/lib/market/index` (launcher call, payout recipient only); the creator desk can reuse it and `vestSchedule`.

## Behaviour
- Instant tokens: no verdict, Walk, trial lifecycle, backers count or genesis stepper anywhere on the page. States: launching (Created, Seeded, Trading), trading, halted, launch failed.
- Verify tab is named "Contract facts" and has no recompute control; it prints `./scripts/verify.sh instant <id>`.
- Order panel on instant pools: opening-fee countdown, self-buy refusal shown before signing (`R_SELF_BUY` for the creator and payout recipient accounts, buys only), instant sub-cap pre-check (`R_MARKET_CAP`) when the market config is readable and an honest "could not be read" otherwise.
- Trades by the creator and payout recipient accounts carry a tag. A second wallet is not detected; the copy says so.
