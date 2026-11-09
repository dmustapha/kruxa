-- Purpose: one-day sample of which parent accounts create sub-accounts, to test whether token-factory activity is visible at scale (context only, not the primary test).
-- Tables: bigquery-public-data.crypto_near_mainnet_us.receipt_actions (columns read: block_date, action_kind, receipt_receiver_account_id, receipt_predecessor_account_id).
-- Expected bytes: about 1.6 GB for the single day (receipt_actions is the heaviest table, which is why this is a one-day sample and not a daily series).
SELECT
  REGEXP_REPLACE(receipt_receiver_account_id, r'^[^.]+\.', '') AS parent_account,
  COUNT(*) AS accounts_created
FROM `bigquery-public-data.crypto_near_mainnet_us.receipt_actions`
WHERE block_date = DATE '{day}'
  AND action_kind = 'CREATE_ACCOUNT'
  AND receipt_receiver_account_id LIKE '%.%'
  AND receipt_predecessor_account_id != 'near'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 40
