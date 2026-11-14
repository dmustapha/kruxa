# Change: Instant launcher completion (announced open and creator views)

Branch `instant-completion`, based on `main` d7c60d5. Closes two items CO-7 designed and the build left out: the announced open (CO-7 2.7, the optional `trade_from_ns` row) and the launcher views (2.13). Spec: `kruxa/CHANGE-ORDER-7-INSTANT-LAUNCH.md`.

## What changed

**Announced open (item B).**
- `create_instant` params gain `trade_delay_secs` (integer 0 to 3600, default 600). Outside the range the launcher refuses `R_TRADE_DELAY` (also in `preview_instant`). The event `instant_created` names it; `get_instant` returns it.
- `open_instant` sends `trade_from_ns` in the `seed_quote` message: `block_timestamp + trade_delay_secs * 1e9` taken when the seed leg is sent, or `"0"` for delay 0. The clock therefore runs from that `open_instant` call, not from `create_instant`. A re-sent seed leg announces afresh; the token leg never changes it.
- The market stores it beside the pool, refuses `buy` before it with `R_NOT_YET_TRADING` (full amount returned, nothing moves), refuses a seed whose `trade_from_ns` is more than 3600 s ahead with `R_TRADE_FROM`, and starts the opening-fee clock at `max(opened_ns, trade_from_ns)`. Sells are not refused (nobody holds the token before the first buy). `get_pool`, `pool_opened` and `instant_opened` carry `trade_from_ns`; `quote_buy` answers `R_NOT_YET_TRADING` before it.
- Exact semantics: buys accepted when `block_timestamp >= trade_from_ns`. Delay 0 and a missing field mean "trade at once", as before.

**Views (item A).** `instants_by_creator(creator, from_index?, limit?)` (oldest first, limit default 20, max 50), `declared_wallets(launch_id)` (creator and payout recipient, once if equal; same shape as the core view), `solvency_report(token_id)` (CO-7 2.13 lists it for the launcher and it was missing; same shape as the market view), and a permissionless `index_creators(from_launch_id, limit)` that backfills the creator index for launches created before this change.

**Backward compatibility (no state layout break).** Nothing stored changed. In the launcher the delay, the announced time and the creator index live in raw storage under prefixes 8 to 12; `Launcher`, `Instant` and the borsh of `InstantParams` (`trade_delay_secs` is `#[borsh(skip)]`) are unchanged. In the market `trade_from_ns` is raw storage `trade_from:` + launch id; `Pool` and `Market` are unchanged. A launcher or market deployed before this change loads every record; old launches read as delay 0, old pools as trade open at once. The charter hash is `sha256(borsh(Charter))` for delay 0 and for old launches, and `sha256(borsh(Charter) ++ delay as u32 little-endian)` for a non-zero delay. Launches created before this change are not in the creator index until `index_creators` covers them (new launches are indexed at create).

**Deploy order.** Deploy the market first (it ignores nothing new from an old launcher). A new launcher against an OLD market sends `trade_from_ns`, which the old market ignores: the delay is then not enforced. Deploy both.

**Behaviour change callers must know.** Omitting `trade_delay_secs` now means 600 s, so a buy right after `open_instant` is refused. Test helper `tests/tests/instant_common/mod.rs::params()` and the testnet scripts `scripts/instant-testnet/{flow,real-flow,real}.mjs` now pass `trade_delay_secs: 0` to keep their old flow.

**Other layers.** ABI docs: `INSTANT-ABI.md` 1.1.0 (section 15), `MARKET-ABI.md` 1.3.0. `LIMITATIONS.md` item 19 removed (number kept retired, other docs cite items by number); it was the only line about these two items. Indexer: schema 5 (`instants.trade_delay_secs`, `pools.trade_from`, replayed on the next start), fold, fixtures. API: `trade_delay_secs` on `instant`, `trade_from` on the pool block, OpenAPI and `app/public/openapi.yaml`. App: types, `R_TRADE_DELAY` mirror, the Instant Studio field "Trading opens after (minutes)" (default 10, 0 to 60, sent as `trade_delay_secs = minutes * 60`), the countdown line "Trading opens in mm:ss" on the Instant launch view while `trade_from_ns` is ahead, a refusal text for `R_NOT_YET_TRADING`, the security page row.

## Tests

New, in-VM: `contracts/instant/src/tests_views.rs` (10), `contracts/market/src/tests.rs::announced_open` (5), `crates/kruxa-instant` (2 new), `crates/kruxa-market/src/trading.rs` (4).
New, sandbox (real wasm): `tests/tests/instant_views.rs` (4), `tests/tests/instant_announced_open.rs` (6): views and paging; buy before `trade_from` refused `R_NOT_YET_TRADING` with funds back; buy at/after accepted; opening fee 500 bps at `trade_from` (a pool opened 600 s earlier would be about 433); delay 0 as before; delay 3601 and non-integers refused; omission gives 600; launcher record, `instant_opened` and market `pool_opened` agree.
Vitest: `lib/instant/{instant,summary}.test.ts`, `components/features/instant/instant.test.tsx`. Indexer `store.test.ts` asserts the new fields.
Results are in the final report of the session (counts and pass state).

## New wasm (non-reproducible local `cargo near build`, `scripts/instant-build.sh`)

| Contract | Bytes | sha256 |
|---|---|---|
| `kruxa_market_contract.wasm` | 262,888 | `e92bc1d17ae8c0e28fbdf3feb7d6faaabfbf9ba9f5887d825dd19a64b2f85a0b` |
| `kruxa_instant_contract.wasm` | 288,574 | `b9b9bedd17ff1776b70a529450db45eb7513059e8c80b2c4b35da266c8870a08` |

Budget: launcher under 300,000 bytes (`scripts/instant-test.sh`), met with 11,426 to spare. The market has no stated budget. `scripts/build.sh` builds core and mocks only; the two wasm come from `scripts/instant-build.sh`. Re-run after any later source edit: cargo-near embeds nothing of the revision for these two non-reproducible builds, but the hash moves with any source change.

## Everything that changes when these hashes are frozen

Old hashes: market `c80560d63663fe71526f88de9ebbf5c8c16979c00ed32d1eb11b13c087ae2b26`, launcher `90b87782e25ee0f7991fac494c895b61a7d4f1008bf02ec32588ac9a6091d255`.

1. `artifacts/SHA256SUMS` lines 2 and 3 (market and launcher); copy the two wasm into `artifacts/`. `artifacts/BUILD-KIND` stays true (non-reproducible).
2. Files that name the old hashes, to re-point or to label as historical (the testnet ones are records of runs on the old wasm and should stay as history; add new run4 records beside them):
   - `app/.env.testnet` (comment on line 16 and the launcher and market accounts after redeploy)
   - `evidence/judge-run.txt` lines 38 and 39 (regenerated by `make judge`)
   - `evidence/attack-gallery/attack-gallery.json` (line 10) and the sibling gallery records; also `INSTANT-ANNOUNCED-OPEN` is listed as "not done" in `docs/ATTACK-GALLERY.md` line 132, `evidence/attack-gallery/not-done.json`, `prefix/` and `red-mode/` records and `app/content/docs/attack-gallery.summary.json`: add a gallery row and rerun the gallery, then drop it from the not-done list
   - `evidence/testnet-core3/deploy.json`, `evidence/testnet-core7/deploy.json` and `deploy-market5.log`, `evidence/swarm-testnet/core4-market/deploy.json` and `deploy-market4.log` (market deploys; history)
   - `evidence/instant-testnet/run3/accounts.json` (launcher and market hashes of run3; history)
   - `evidence/verify/instant-1111-1000000000.txt`, `instant-1111-1000000001.txt`, `instant-1111-1000000000-tamper-all.txt`, `instant-1000000000-code-vs-artifacts-MISMATCH.txt` (their CODE line compares with `artifacts/SHA256SUMS`; they will read MISMATCH against the new artifacts, so regenerate on run4)
   - `LIMITATIONS.md` (lines naming `90b87782`), `rehearsal/LOG.md`, `rehearsal/ROUND2.md`, `docs/runbooks/testnet-core3.md`, `docs/runbooks/instant-testnet.md` (section 6 and a new section 7 for run4), `docs/DC-MAP.md` if it quotes sizes
3. Testnet redeploy (needs the owner's keys; not done here): redeploy the market wasm, then the launcher wasm, on a fresh root as in run3 (state layout is compatible, so an in-place upgrade of existing accounts also loads; a fresh root is cleaner for evidence). Then `set_launcher` on the market, `set_market` on the launcher, `open_beta` if mainnet profile. Optionally call `index_creators` for old launches.
4. Run4 rerun: `KXI_ROOT=<root> KXI_EVID=evidence/instant-testnet/run4 node scripts/instant-testnet/fund.mjs`, then `real-flow.mjs`; add a step that creates with `trade_delay_secs: 120`, shows a buy refused `R_NOT_YET_TRADING`, waits, buys; then `KRUXA_LAUNCHER=<launcher> scripts/verify.sh instant <id>` and `--tamper-all`; the verifier must hash a charter with a non-zero delay as `sha256(borsh ++ delay)` (verify.sh instant does not recompute the charter hash today, check C-lines).
5. Indexer: bump already done (schema 5); a running indexer rebuilds derived tables on start. Redeploy the API after the indexer.
6. `make judge` (not run here) after the freeze.
