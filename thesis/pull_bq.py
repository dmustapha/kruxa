"""Live refresh: runs every query in queries/ against BigQuery under the cost guard and rewrites snapshots/*.csv plus snapshots/MANIFEST.json.
Needs GOOGLE_APPLICATION_CREDENTIALS (or BQ_KEY_FILE) pointing at a service-account key file. Not used by `make thesis`.
Usage: python pull_bq.py [usage|events|factory|all]"""
import csv, datetime, hashlib, json, os, sys
import bqguard

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(HERE, "snapshots")
START, END = datetime.date(2025, 9, 1), datetime.date(2026, 11, 7)
SAMPLE_STEP_DAYS = 20

def fill(sql, **kw):
    for k, v in kw.items():
        sql = sql.replace("{" + k + "}", str(v))
    return sql

def read_sql(name):
    return open(os.path.join(HERE, "queries", name)).read()

def month_chunks(a, b):
    cur = a
    while cur <= b:
        nxt = (cur.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
        yield cur, min(b, nxt - datetime.timedelta(days=1))
        cur = nxt

def write_csv(name, rows):
    path = os.path.join(SNAP, name)
    cols = list(rows[0].keys())
    with open(path, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(cols)
        for r in rows:
            w.writerow([str(r[c]) if r[c] is not None else "" for c in cols])
    return path

def update_manifest(snapfile, qfile, sql_text, extra):
    mp = os.path.join(SNAP, "MANIFEST.json")
    man = json.load(open(mp)) if os.path.exists(mp) else {}
    h = hashlib.sha256(open(os.path.join(SNAP, snapfile), "rb").read()).hexdigest()
    man[snapfile] = {"sha256": h, "query_file": "queries/" + qfile,
                     "query_sha256": hashlib.sha256(open(os.path.join(HERE, "queries", qfile), "rb").read()).hexdigest(),
                     "pulled_on": datetime.date.today().isoformat(), **extra}
    json.dump(man, open(mp, "w"), indent=1, sort_keys=True)

def pull_usage():
    sql = read_sql("01_daily_usage.sql")
    rows = []
    for a, b in month_chunks(START, END):
        rows += bqguard.run(fill(sql, start=a, end=b), f"usage_{a:%Y-%m}")
    rows.sort(key=lambda r: r["block_date"])
    write_csv("daily_usage.csv", rows)
    update_manifest("daily_usage.csv", "01_daily_usage.sql", sql, {"window": f"{START}..{END}", "rows": len(rows)})

def sample_days():
    d, out = START, []
    while d <= END:
        out.append(d); d += datetime.timedelta(days=SAMPLE_STEP_DAYS)
    return out

def pull_events():
    sql = read_sql("02_intents_events_sample.sql")
    rows = []
    for d in sample_days():
        rows += bqguard.run(fill(sql, day=d), f"events_{d}")
    write_csv("intents_events_sample.csv", rows)
    update_manifest("intents_events_sample.csv", "02_intents_events_sample.sql", sql,
                    {"window": f"every {SAMPLE_STEP_DAYS}th day from {START}", "rows": len(rows)})

def pull_factory():
    sql = read_sql("03_account_creation_parents_sample.sql")
    day = "2026-10-15"
    rows = bqguard.run(fill(sql, day=day), "factory_probe")
    write_csv("account_creation_parents_sample.csv", rows)
    update_manifest("account_creation_parents_sample.csv", "03_account_creation_parents_sample.sql", sql, {"window": day, "rows": len(rows)})

if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    os.makedirs(SNAP, exist_ok=True)
    if what in ("usage", "all"): pull_usage()
    if what in ("events", "all"): pull_events()
    if what in ("factory", "all"): pull_factory()
    print("ledger total GB:", bqguard.total_bytes() / 1e9)
