# THESIS: NEAR Intents activity is real and growing, but it does not lead the rest of NEAR's usage

Track: Investment Thesis (`thesis`). Data: public BigQuery dataset `bigquery-public-data.crypto_near_mainnet_us`, block dates 2025-09-01 to 2026-11-07. Every number below is written into this file by `build.py` from the committed files in `snapshots/`; none is typed by hand. Tags: [VERIFIED] means the query was run and the result is in a snapshot; [UNVERIFIED] means it was not run or cannot be run from these sources.

## 1. Claim and verdict

**Hypothesis H1 (stated before the final run).** Week-on-week growth in `intents.near` settlement transactions (`tx_intents`) leads, by 1 to 28 days, week-on-week growth in daily active NEAR signer accounts that did not call `intents.near` (`signers_ex_intents`). If true, cross-chain settlement activity would be an early read on real network usage.

**Verdict: not supported.** Over 420 days the best positive-lag correlation is r = 0.173 at a lag of 10 days. A circular-shift permutation test of the same maximum statistic gives p = 0.561; the 95th percentile of the null maximum is r = 0.413. The incremental test (does `tx_intents` seven days earlier explain `signers_ex_intents` beyond its own 7- and 14-day lags?) adds 0.0111 to R-squared (permutation p = 0.419). [VERIFIED]

**What survives.** A narrower, descriptive claim holds in the data: Intents is a rising share of NEAR's on-chain transaction count (0.8 percent in 2025-09, 8.9 percent in 2026-10), and the stablecoin-leg swap notional on the sampled days has a median of $40.7M per day, with the later third of samples above the earlier third. That is the extent of what the data supports: Intents carries a large and rising amount of stablecoin-leg flow on NEAR. It does not say Intents activity predicts anything else. [VERIFIED]

**First-pass disclosure.** Before the final run I ran one exploratory pass of the same lead-lag code with 300 permutations on `tx_intents` and several other candidate leaders. The window, transform, lag range (1 to 28) and the rule "supported only if p < 0.05 on the full window" were fixed at that point and not changed after seeing results. The regime split and the reverse-direction test were added in the final run and are labelled exploratory below.

## 2. Data and definitions

All tables are read-only public data. Queries live in `queries/` and each has a header with purpose, tables and expected bytes.

| Series | Definition | Source query |
|---|---|---|
| `tx_total` | transactions per `block_date` | `queries/01_daily_usage.sql` |
| `tx_intents` | transactions whose `receiver_account_id` is `intents.near` | same |
| `signers_ex_intents` | distinct `signer_account_id` on transactions not addressed to `intents.near` ("daily active accounts") | same |
| `signers_multi` | those signers that hit at least 3 distinct receiver accounts that day (a bot-resistant proxy) | same |
| `receivers_ex_intents` | distinct receiver accounts excluding `intents.near` (contract usage breadth) | same |
| `stable_pos_usd` | sum of positive named USDC/USDT legs in `token_diff` events emitted by `intents.near`, divided by 1e6, on one sampled day every 20 days | `queries/02_intents_events_sample.sql` |

The Intents Explorer API is not used (it needs a partner JWT we do not have). Intents activity is derived from the chain itself: `tx_intents` from the `transactions` table and swap notional from `intents.near` event logs in `execution_outcomes`. The derivation is feasible for transaction counts and for stablecoin-leg notional; it is not feasible for a full USD volume (see section 8). [VERIFIED]

The transform for the test is `z_t = log(mean of last 7 days at t) - log(mean of last 7 days at t-7)`. This removes level and slow trend and leaves week-on-week growth. Significance comes from circular shifts of the leading series (at least 45 days), which keep its autocorrelation and break its alignment with the target, using 1000 shifts and the same "maximum over lags 1 to 28" statistic as the observed value.

## 3. What would change my mind

H1 would be accepted if all of these held: (a) full-window best-lag r positive with p < 0.05; (b) the same sign in both regimes below; (c) the reverse direction (usage leading Intents) not stronger; (d) a positive incremental R-squared with p < 0.05. Result: (a) not met, (b) met (pre-break r = 0.202, p = 0.937; post-break r = 0.286, p = 0.161), (c) not met (reverse full-window r = 0.086, p = 0.848; reverse post-break p = 0.001), (d) not met.

I would also revise the verdict if a later refresh (`make thesis-live`) shows a full-window p below 0.05, or if a USD-volume series (not available here) correlated with future signers at the level the test can detect.

## 4. Evidence for the narrower claim (Intents is a growing slice of NEAR activity)

- Intents share of transactions rose from 0.8 percent (2025-09) to 8.9 percent (2026-10); the partial month 2026-11 (7 days) is at 19.7 percent. [VERIFIED]
- `tx_intents` averaged 38,678 per day in 2025-09 and 64,962 per day in 2026-10. [VERIFIED]
- Sampled-day stablecoin-leg swap notional: median $40.7M, minimum $4.8M, maximum $83.1M across 22 days; median of the first third of samples $33.0M, of the last third $54.3M. [VERIFIED]
- Distinct 64-hex (implicit) accounts in `token_diff` events on sampled days went from 3,971 (2025-09-01) to 15,603 (2026-10-26). Implicit accounts are mostly wallets of users coming from other chains, but solvers can also use them, so this is a ceiling on users, not a count of users. [VERIFIED for the counts, UNVERIFIED for the interpretation]

## 5. Evidence against

- **No lead.** See section 1. A lead at least this strong appears in 56 percent of circular shifts of the Intents series, so it is indistinguishable from chance. [VERIFIED]
- **Base usage fell while Intents grew.** Average daily `signers_ex_intents` was 298,175 in 2025-09 and 71,991 in 2026-10. The rising Intents share is therefore partly a shrinking denominator, not only a growing numerator. [VERIFIED]
- **A data-visible regime break.** On 2026-04-02 daily `tx_total` fell from 3,954,553 to 952,028 (average of the 7 days either side) and distinct receivers from 2,964,744 to 232,007, while daily signers barely moved (137,021 to 132,708). That pattern fits a large dust or spam source switching off; the table cannot say why. Level comparisons across the break are not safe, which is why the test uses growth rates and reports regimes separately. [VERIFIED for the numbers, UNVERIFIED for the cause]
- **Usage leads Intents after the break (exploratory).** In the 207 days after the break, `signers_ex_intents` growth leads `tx_intents` growth with best r = 0.527 at 28 days, permutation p = 0.001. The best lag is at the edge of the allowed 1 to 28 day range, which suggests a slow common movement rather than a clean lag, and this is one of six regime and direction tests, so I treat it as a lead to investigate, not a finding. [VERIFIED as computed, UNVERIFIED as causal]
- **The transaction-count proxy does not track notional well.** Across 22 sampled days the Pearson correlation between `tx_intents` and `stable_pos_usd` is 0.180 (Spearman 0.505). Single days are dominated by event bursts: on 2025-10-11, `tx_intents` was 272,241 while the stablecoin-leg notional was $36.8M, and `token_diff` entries involved 83,342 distinct named accounts. A one-off campaign or spam wave moves transaction counts without moving value. [VERIFIED]
- **Other leaders do no better.** Best lead against `signers_ex_intents`, full window: `tx_intents` r = 0.173 at 10 days, p = 0.561; `intents_signers` r = 0.370 at 14 days, p = 0.121; `signers_multi` r = 0.196 at 7 days, p = 0.322; `receivers_ex_intents` r = 0.290 at 1 days, p = 0.210; `tx_ex_intents` r = 0.095 at 2 days, p = 0.460. None clears p < 0.05. [VERIFIED]

## 6. Limitations

- The Intents series is a transaction count for the lead-lag test; value is available only on 22 sampled days, so the test cannot be run on notional. A value-based leader might behave differently. [VERIFIED]
- Daily active accounts count signer accounts, which include bots; `signers_multi` is a partial guard, not a proof of humans.
- Power is limited: with 420 days of overlapping weekly changes the permutation null for the maximum lead correlation reaches r = 0.413, so effects smaller than about that size cannot be told from chance here.
- The window starts 2025-09-01 and covers one cycle. Nothing here says what happens in a different market.
- Correlation, lead-lag or not, is not causation. A lead would have been a reason to look, never proof.
- `tx_intents` counts transactions addressed to `intents.near` (mostly relayer and solver submissions). Deposits arrive as token-contract transfers and are not in that count, and one transaction can carry several intents, so it is a proxy for settlement activity, not an exact count of swaps. [VERIFIED by definition]
- Failed transactions are not separated: in a one-day check (2026-10-15) the `transactions.status` column had a single value, so success versus failure was not derivable from that table. [VERIFIED for that day only]
- Price is not in this dataset. The hypothesis in the track prompt (Intents volume versus token price) is not tested. [VERIFIED]

## 7. Is token creation a second demand source? (not tested)

The second candidate hypothesis was that factory token launches are a new demand source. A one-day sample of sub-account creation by parent account (`queries/03_account_creation_parents_sample.sql`, 2026-10-15) shows launch-like parents (for example `launchpad.justhoot.near` with 10 accounts created that day) against 606 accounts under the largest parent (`abound.near`). A daily series would need `receipt_actions`, about 1.6 GB per day, which is not affordable inside the shared quota for this window. I do not claim a result. [VERIFIED for the one-day sample, UNVERIFIED for any trend]

## 8. Cannot compute from these sources

- Full USD volume of Intents (swaps that have no stablecoin leg; every day outside the sampled days). No price feed is available offline or in the dataset.
- Intents volume from the Explorer API (needs a partner JWT).
- NEAR token price and any price-based indicator.
- The real number of Intents end users (the chain does not label users versus solvers).
- Daily token-creation counts for the whole window (cost).
- Transaction failure rate (see limitations).
- Anything before 2025-09-01 (cost choice, not a data limit).

## 9. Why this matters for a trust-first NEAR launch platform

The data says two things that bear on Kruxa, a NEAR-settled, trust-minimized cross-chain token launch platform, without needing a lead-lag story. First, a median of $40.7M per sampled day of stablecoin-leg notional already settles through one public contract whose every step is an on-chain event anyone can query with the files in this repository: the settlement rail Kruxa depends on is used at scale and is auditable the same way this thesis is. Second, the 22 sampled days show bursts of activity that move transaction counts by large factors without moving value (2025-10-11); a launch venue that wants to be believed has to publish the same kind of reproducible evidence about itself instead of quoting activity counts. The honest limit: none of this shows demand for token launches. Section 7 is an open question, not a result, and Kruxa's own traction is not evidence in this thesis.

## 10. Reproduce

```
make thesis        # offline, stdlib Python 3 only: verifies snapshot sha256, reruns every test, rebuilds charts, dashboard and this file
make thesis-live   # needs GOOGLE_APPLICATION_CREDENTIALS (or BQ_KEY_FILE) for a read-only BigQuery service account; cost-guarded; rewrites snapshots
open dashboard/index.html
```

`make thesis` prints one `CHART <id> sha256=<hash>` line per chart, one `SNAPSHOT` line per CSV (the hash is checked against `snapshots/MANIFEST.json`) and ends with `THESIS OK`. The live refresh dry-runs every query, aborts any query above 20 GB, keeps a running ledger in `query-ledger.json` and refuses to exceed 200 GB. Ledger total for this pack: 119.6 GB across 55 queries. [VERIFIED]
