"""Cost-guarded BigQuery runner. Dry run first; refuses >20 GB per query or >200 GB cumulative (query-ledger.json)."""
import hashlib, json, os, datetime
LEDGER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "query-ledger.json")
PER_QUERY_MAX = 20 * 10**9
TOTAL_MAX = 200 * 10**9
PROJECT = os.environ.get("BQ_PROJECT", "claude-490403")

def _ledger():
    if os.path.exists(LEDGER):
        return json.load(open(LEDGER))
    return {"entries": []}

def total_bytes():
    return sum(e["bytes"] for e in _ledger()["entries"])

def client():
    from google.cloud import bigquery
    from google.oauth2 import service_account
    key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get("BQ_KEY_FILE")
    if not key:
        raise SystemExit("set GOOGLE_APPLICATION_CREDENTIALS or BQ_KEY_FILE (live refresh only)")
    creds = service_account.Credentials.from_service_account_file(os.path.expanduser(key))
    return bigquery.Client(project=PROJECT, credentials=creds)

def run(sql, label=""):
    from google.cloud import bigquery
    c = client()
    dry = c.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
    est = dry.total_bytes_processed
    if est > PER_QUERY_MAX:
        raise SystemExit(f"ABORT {label}: dry run {est/1e9:.1f} GB > 20 GB cap")
    if total_bytes() + est > TOTAL_MAX:
        raise SystemExit(f"ABORT {label}: ledger {total_bytes()/1e9:.1f} GB + {est/1e9:.1f} GB > 200 GB cap")
    job = c.query(sql, job_config=bigquery.QueryJobConfig(use_query_cache=False))
    rows = [dict(r) for r in job.result()]
    billed = job.total_bytes_processed or 0
    led = _ledger()
    led["entries"].append({"label": label, "query_sha256": hashlib.sha256(sql.encode()).hexdigest(),
                           "dry_run_bytes": est, "bytes": billed,
                           "date": datetime.date.today().isoformat()})
    json.dump(led, open(LEDGER, "w"), indent=1)
    print(f"{label}: {billed/1e9:.3f} GB (ledger total {total_bytes()/1e9:.3f} GB)")
    return rows
