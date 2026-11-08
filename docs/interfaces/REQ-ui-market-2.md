# REQ-ui-market-2 (from U2, trade view v2)

Readers: U1 (layout, trial page, verify page), I (indexer API), wallet owner. Builds on REQ-ui-market.md. Branch `ws/market-ui2`.

## For U1 (layout and nav)
1. **Width.** `/token/[id]` needs about 1240 px. U2 widens `main` with `main:has(.mkt-root) { max-width: 1240px }` in `components/market/market.css`. A per-route width in the layout is cleaner; when it exists, delete that rule.
2. **Mobile bottom tab bar.** The token page has its own sticky Buy / Sell bar (class `.mkt-sticky-bar`, fixed, 56 px buttons, safe-area padded, hidden from 1024 px). The global bottom tabs must hide on this route: `body:has(.mkt-sticky-bar) .bottom-tabs { display: none }` (or the layout's own selector). The token page also adds `padding-bottom: 88px` under 1024 px.
3. **Links into the token page.** Discover cards for launches with phase TRADING (and PASS) should link to `/token/[id]`. Deep links: `/token/[id]?tab=trades|holders|mechanics|creator|verify` (mobile folds mechanics and creator into `info`). The trial page should link "Trade it" when `has_market` is true and the token page links back with "Go to the trial".
4. **Back chevron** in the top bar on `/token/[id]` on mobile (APP-SPEC 2.3).
5. **Routes the token page links to:** `/` (browse), `/launch/[id]`, `/launch/[id]/verify`, `/charter`, `/ops-log` (halted banner). If `/ops-log` is not built, the link 404s; tell U2 and the halted banner will drop it.
6. **WalletProvider** in the root layout. The token page mounts its own only if none exists.

## Shared helpers (import from the barrels, do not copy)
- `@/lib/market/index`: `phaseOf`, `tokenState`, `PHASE_LABEL` (APP-SPEC 2.4 vocabulary, same words everywhere; IR-A10 `phase` is read when the API sends it), `genesisSteps` (token-page variant of the stepper), `recompute`, `tampered`, `bookHashCheck`, `summarize`, `readSnapshot`, `verifyCommand` (browser recompute with the tamper toggle, same Check/status semantics as U1's `lib/verify.ts`), `safetyTiles`.
- `@/components/market/index`: `Sigil` (generated avatar, deterministic from launch id and symbol), `PhaseBadge`, `GenesisStepper`, `VerifyPanel` (the whole recompute UI with the tamper checkbox and the `verify.sh` command), `SafetyTiles`, `CopyButton`.
- **Duplication to remove:** `lib/market/verify.ts` duplicates U1's `lib/verify.ts` because U1's file is not on main yet. When it lands, make one the source and re-export from the other; both are pinned by tests to `lib/verdict.ts`. U1's `VerifyView` can render `<VerifyPanel launchId>` directly.

## For I (indexer API), all optional, the UI shows unknown when absent
- `stats.windows`: `{ "5m"|"1h"|"6h"|"24h": { change_pct, buys, sells, buy_volume, sell_volume, traders } }` (IR-A5). Today the rail derives these from the 200 latest swaps and prints "unknown" when they do not reach back far enough.
- `genesis` object on `TokenPage` and `LaunchDetail` (IR-A4): `{ network, path, stage: none|spec_committed|mint_created|authorities_set|distributor_set|claims_open, spec_hash, mint, tx_create, tx_authority, distributor, root }`. Steps without it render as unknown.
- `GET /api/creator/{account}` `claims[]` (exists): the chart draws creator claims and stream draws from it.
- `launch.phase` (IR-A10), `launch.name` (IR-A1): read when present.
- Trades: a `fee_slices` field per swap is already read; epochs fold from it.

## Behaviour decisions (U2) worth knowing
- Fixture data disables the order panel ("Fixture data: nothing here is on a chain", APP-SPEC 5.5).
- A failed trial shows a card with a link to refunds instead of a redirect.
- Markers and the legend say "known creator accounts only, not wallets they may control".
- "Liquidity" tile says "no LP withdrawal method" only when the `lp_in_pool` indicator is a logged pass; it never says locked.
