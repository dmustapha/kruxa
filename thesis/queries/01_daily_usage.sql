-- Purpose: daily NEAR usage (transactions, active signer accounts, contract breadth) and daily intents.near transaction activity.
-- Tables: bigquery-public-data.crypto_near_mainnet_us.transactions (columns read: block_date, signer_account_id, receiver_account_id).
-- Expected bytes: about 1.2 GB per month in mid-2026, 6 to 11 GB per month in late 2025 and early 2026 (about 60 GB for the full window, run in monthly chunks; {start} and {end} are substituted by the runner and always bound block_date).
-- Metrics per block_date:
--   tx_total             all transactions
--   tx_intents           transactions whose receiver is intents.near
--   signers_total        distinct signer accounts, all transactions
--   signers_ex_intents   distinct signers of transactions NOT addressed to intents.near
--   signers_multi        signers (excluding intents.near calls) that hit at least 3 distinct receiver contracts that day (bot-resistant proxy)
--   receivers_ex_intents distinct receiver accounts excluding intents.near (contract usage breadth)
--   intents_signers      distinct signers of transactions to intents.near (relayers and solvers, not end users)
WITH sr AS (
  SELECT block_date, signer_account_id AS s, receiver_account_id AS r, COUNT(*) AS c
  FROM `bigquery-public-data.crypto_near_mainnet_us.transactions`
  WHERE block_date BETWEEN DATE '{start}' AND DATE '{end}'
  GROUP BY 1, 2, 3
),
per_signer AS (
  SELECT block_date, s, COUNTIF(r != 'intents.near') AS nr_ex
  FROM sr GROUP BY 1, 2
)
SELECT
  block_date,
  SUM(c) AS tx_total,
  SUM(IF(r = 'intents.near', c, 0)) AS tx_intents,
  COUNT(DISTINCT s) AS signers_total,
  COUNT(DISTINCT IF(r != 'intents.near', s, NULL)) AS signers_ex_intents,
  COUNT(DISTINCT IF(r != 'intents.near', r, NULL)) AS receivers_ex_intents,
  COUNT(DISTINCT IF(r = 'intents.near', s, NULL)) AS intents_signers,
  (SELECT COUNTIF(p.nr_ex >= 3) FROM per_signer p WHERE p.block_date = sr.block_date) AS signers_multi
FROM sr
GROUP BY block_date
ORDER BY block_date
