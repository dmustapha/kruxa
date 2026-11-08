# REQ-ui-instant (from U1, instant launch surfaces)

Readers: U2 (token page), I (indexer API 1.2.0), L (launcher), D (docs). Source: CHANGE-ORDER-7 section 4, INSTANT-ABI 1.0.0 (draft). Branch `ws/ui`.

## What U1 built that U2 can import (do not copy)
- `@/components/ui/PhaseBadge`: `ModeBadge({ mode })`. The ONLY two launch-type badges: `Trial-verified` (mode `trial`, or `mode` absent) and `Instant (no trial)` (mode `instant`). Put it beside the phase badge in the token header.
- `@/components/features/instant/InstantParts`: `InstantNotice` (the non-dismissible "Launched instantly: no trial" notice, CO-7 4.3), `RiskPanel`, `RISK_POINTS`.
- `@/components/features/instant/VestPanel`: `VestPanel({ launchId, symbol })`, the allocation meter, cliff, unlocked, claimed, claimable and the `claim_vested` button. Reads the launcher's `get_vesting` view. Use it in the token page Creator tab for instant launches.
- `@/components/features/instant/InstantProgress`: `InstantProgress({ launchId })`, the 3-step tracker (create, seed, open) with the next action. The token page shows it only while the pool is not open.
- `@/lib/phase`: `phaseOf` now returns `LAUNCHING` and `LAUNCH_FAILED` for instant launches (`mode === 'instant'`), and `TRADING` once `has_market` or status `trading`. `isInstant(l)`.
- `@/lib/instant/rules`: `unlockedAt`, `cliffEnd`, `vestEnd`, `deriveInstant` (exact split: pool plus allocation is the whole supply). `@/lib/instant/preview`: `getVesting`, `getInstant`, `getInstantPhase`, `isInstantId(id)` (ids at or above 1,000,000,000).

## What the token page needs to do for an instant launch (U2)
1. Detect instant by `launch.mode === 'instant'` from `/api/token/{id}` (OpenAPI 1.2.0) or `isInstantId(id)`. Show `ModeBadge` and `InstantNotice` under the header.
2. Remove: verdict panel, Walk, the trial lifecycle stepper, stream meter, backers count, genesis on Solana, the "Trial-verified" badge. Do not call `/launch/{id}/verify` links: that page says an instant launch has no verdict.
3. Safety tiles: keep pool liquidity permanent (no withdrawal method), fixed supply (with the factory publisher caveat), fee split bar with the hatched redirected slices, opening fee countdown, payout recipient fixed, creator allocation (`VestPanel`). Show "Solana mint: none (NEAR-only launch)". The tile "authorities null" must NOT appear.
4. Trades table: flag trades by declared wallets (creator, payout recipient) when the API sends `declared: true`.
5. A trade page for an instant launch that is not open yet (`LAUNCHING`): link to `/launch/[id]`, which shows `InstantProgress`.

## What U1 expects from I (OpenAPI 1.2.0), all optional: the UI shows unknown when absent
- `LaunchSummary.mode`: `trial` or `instant` (missing is read as trial) and `GET /api/launches?mode=trial|instant`. The feed also filters client-side as a fallback.
- `LaunchSummary.status`: `launching` and `trading` for instant launches (read by `phaseOf`).
- `LaunchDetail.alloc` (`total, unlocked, claimed, claimable, cliff_end, vest_end, alloc_bps, cliff_days, vest_days, seed_q`). The UI reads the launcher's `get_vesting` over RPC as the authority and does not need it.
- `LaunchSummary.created_at` for instant launches: the Create form uses it for the one-per-24-hours check (`R_RATE_LIMIT`), together with `?creator=`.

## What U1 expects from L (launcher)
- Views used today: `get_config`, `preview_instant(params, creator, payout_recipient)`, `get_instant`, `get_phase`, `get_vesting`, `instants_by_creator`. Methods used: `create_instant`, `USDC.ft_transfer_call(seed_instant)`, `open_instant`, `cancel_instant`, `abort_instant`, `reclaim_deposit`, `claim_vested`.
- ABI typo to confirm: section 3 says `abandon_instant` after "24 u" and `abort_instant` after "72 u" where `unit` is one day. CO-7 says 72 hours. The UI avoids stating a number until this is settled.
- The UI does not offer an announced-open delay (the ABI dropped `trade_delay_secs`).

## Open points
- Trial Studio defaults are now 72 h commit, 6 h tail, 30 day stream, with the 24 h and 1 h floors. PRD 4b and USER-ONBOARDING still say a 90 day default stream; the core test example uses 30. Docs need the same number.
- The instant form shows the flat $10 launch fee only on mainnet (the ABI: zero elsewhere). On mainnet the Create page says instant launches are closed until the capped beta opens when the launcher's `creator_gate` is true or the launcher cannot be read.
