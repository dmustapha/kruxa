# Read-only connectivity check: dry run first (no data processed), then the same small freshness query.
import os
from google.cloud import bigquery
from google.oauth2 import service_account

KEY = os.path.expanduser(os.environ['GOOGLE_APPLICATION_CREDENTIALS'])
creds = service_account.Credentials.from_service_account_file(KEY)
client = bigquery.Client(project='claude-490403', credentials=creds)
SQL = """SELECT MAX(block_date) AS latest
FROM `bigquery-public-data.crypto_near_mainnet_us.transactions`
WHERE block_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)"""
dry = client.query(SQL, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
print('dry run ok, bytes to process:', dry.total_bytes_processed)
if dry.total_bytes_processed > 500_000_000:
    raise SystemExit('refusing: more than 500 MB')
rows = list(client.query(SQL).result())
print('latest block_date:', rows[0]['latest'])
