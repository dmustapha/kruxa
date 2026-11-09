-- Purpose: for ONE sampled day, count NEAR Intents (intents.near) log events and derive a stablecoin-leg swap notional and account counts from token_diff events.
-- Tables: bigquery-public-data.crypto_near_mainnet_us.execution_outcomes (columns read: block_date, executor_account_id, logs).
-- Expected bytes: about 4 GB per sampled day for Sep 2025 to Mar 2026, about 1.3 GB per day after Apr 2026 (the runner executes one query per sampled day, {day} is substituted and always bounds block_date).
-- Definitions (all computed from on-chain logs, no price feed):
--   ev_* columns          number of EVENT_JSON log lines of that event type emitted by intents.near that day
--   stable_pos_usd        sum of POSITIVE amounts of named 6-decimal USDC/USDT legs inside token_diff events, divided by 1e6. A swap with one stablecoin leg is counted once;
--                         a stable-to-stable swap is counted twice (user side and solver side); swaps with no stablecoin leg are not counted (no price source).
--   accts_* columns       distinct account_id values seen in token_diff entries (this mixes end users and solvers): 0x = EVM-style address, hex64 = 64-hex implicit account, named = contains a dot
WITH ev AS (
  SELECT PARSE_JSON(SUBSTR(l.element, 12)) AS j
  FROM `bigquery-public-data.crypto_near_mainnet_us.execution_outcomes` e, UNNEST(e.logs.list) l
  WHERE e.block_date = DATE '{day}'
    AND e.executor_account_id = 'intents.near'
    AND STARTS_WITH(l.element, 'EVENT_JSON:')
),
counts AS (
  SELECT
    COUNTIF(JSON_VALUE(j, '$.event') = 'token_diff') AS ev_token_diff,
    COUNTIF(JSON_VALUE(j, '$.event') = 'intents_executed') AS ev_intents_executed,
    COUNTIF(JSON_VALUE(j, '$.event') = 'mt_mint') AS ev_mt_mint_deposits,
    COUNTIF(JSON_VALUE(j, '$.event') IN ('ft_withdraw', 'mt_withdraw', 'native_withdraw', 'nft_withdraw')) AS ev_withdraws,
    COUNTIF(JSON_VALUE(j, '$.event') = 'transfer') AS ev_transfer,
    COUNTIF(JSON_VALUE(j, '$.event') = 'mt_transfer') AS ev_mt_transfer
  FROM ev
),
td AS (
  SELECT JSON_VALUE(x, '$.account_id') AS acct,
         REGEXP_EXTRACT_ALL(TO_JSON_STRING(JSON_QUERY(x, '$.diff')), r'"[^"]+":"-?[0-9]+"') AS pairs
  FROM ev, UNNEST(JSON_QUERY_ARRAY(j, '$.data')) x
  WHERE JSON_VALUE(j, '$.event') = 'token_diff'
),
legs AS (
  SELECT acct,
         REGEXP_EXTRACT(p, r'^"(?:nep141:)?([^"]+)"') AS tok,
         SAFE_CAST(REGEXP_EXTRACT(p, r':"(-?[0-9]+)"$') AS FLOAT64) AS amt
  FROM td, UNNEST(pairs) p
),
st AS (
  SELECT
    SUM(IF(is_stable AND amt > 0, amt, 0)) / 1e6 AS stable_pos_usd
  FROM (SELECT acct, amt,
          tok IN ('eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
                  'eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
                  'tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
                  'sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
                  'sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near',
                  'base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
                  'arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
                  'arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near',
                  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
                  'usdt.tether-token.near') AS is_stable
        FROM legs)
),
acc AS (
  SELECT
    COUNT(DISTINCT acct) AS accts_token_diff,
    COUNT(DISTINCT IF(STARTS_WITH(acct, '0x'), acct, NULL)) AS accts_0x,
    COUNT(DISTINCT IF(REGEXP_CONTAINS(acct, r'^[0-9a-f]{64}$'), acct, NULL)) AS accts_hex64,
    COUNT(DISTINCT IF(acct LIKE '%.%', acct, NULL)) AS accts_named
  FROM td
)
SELECT DATE '{day}' AS block_date, counts.*, st.stable_pos_usd, acc.*
FROM counts, st, acc
