"""Pure-stdlib analysis of the committed snapshots. Deterministic (fixed seed). No network, no credentials."""
import csv, datetime, math, os, random
from operator import mul

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(HERE, "snapshots")
SEED, N_PERM, MAX_LAG, MIN_SHIFT = 20261108, 1000, 28, 45

def load(name):
    with open(os.path.join(SNAP, name)) as f:
        return list(csv.DictReader(f))

def pearson(a, b):
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    da = [x - ma for x in a]; db = [x - mb for x in b]
    sa = math.sqrt(sum(map(mul, da, da))); sb = math.sqrt(sum(map(mul, db, db)))
    return sum(map(mul, da, db)) / (sa * sb) if sa and sb else 0.0

def rank(a):
    order = sorted(range(len(a)), key=lambda i: a[i]); r = [0.0] * len(a)
    for pos, i in enumerate(order): r[i] = float(pos)
    return r

def spearman(a, b):
    return pearson(rank(a), rank(b))

def weekly_log_change(x, w=7):
    """log of trailing w-day mean, differenced over w days: removes level and slow trend, keeps week-on-week growth."""
    m = [None] * len(x)
    for i in range(w - 1, len(x)):
        m[i] = sum(x[i - w + 1:i + 1]) / w
    out = [None] * len(x)
    for i in range(2 * w - 1, len(x)):
        out[i] = math.log(m[i] / m[i - w])
    return out

def lag_corr(lead, tgt, k, lo, hi):
    """corr(lead[t], tgt[t+k]) over t in [lo, hi) such that both indices are in range."""
    a = [lead[t] for t in range(lo, hi) if 0 <= t + k < len(tgt) and t + k < hi + MAX_LAG]
    b = [tgt[t + k] for t in range(lo, hi) if 0 <= t + k < len(tgt) and t + k < hi + MAX_LAG]
    return pearson(a, b) if len(a) > 30 else 0.0

def window(series, lo, hi):
    return series[lo:hi]

def best_lead(lead, tgt, lags):
    """Return (best_k, best_r) maximising r over positive lags (lead leads target by k days)."""
    rs = {k: pearson(lead[:len(lead) - k] if k > 0 else lead, tgt[k:] if k > 0 else tgt) for k in lags}
    k = max(rs, key=lambda q: rs[q]); return k, rs[k], rs

def clean(lead, tgt):
    start = max(next(i for i, v in enumerate(lead) if v is not None), next(i for i, v in enumerate(tgt) if v is not None))
    return lead[start:], tgt[start:], start

def ccf_test(lead, tgt, lags=range(1, MAX_LAG + 1), n_perm=N_PERM, seed=SEED):
    """Max positive-lag correlation of lead->tgt, with a circular-shift permutation null for the same max statistic.
    Circular shifts of the leader keep its autocorrelation and break its alignment with the target."""
    lead, tgt, _ = clean(lead, tgt)
    n = len(lead)
    k, r, rs = best_lead(lead, tgt, lags)
    rng = random.Random(seed); null = []
    for _ in range(n_perm):
        s = rng.randrange(MIN_SHIFT, n - MIN_SHIFT)
        sh = lead[s:] + lead[:s]
        null.append(best_lead(sh, tgt, lags)[1])
    null.sort()
    p = (1 + sum(1 for v in null if v >= r)) / (1 + n_perm)
    return {"n": n, "best_lag": k, "best_r": r, "p_perm": p, "null95": null[int(0.95 * n_perm)],
            "r_by_lag": rs, "r_by_lag_null95": None}

def lag_band(lead, tgt, lags, n_perm=300, seed=SEED):
    """Per-lag 95th percentile of |r| under the circular-shift null (for the chart band)."""
    lead, tgt, _ = clean(lead, tgt); n = len(lead); rng = random.Random(seed + 1)
    vals = {k: [] for k in lags}
    for _ in range(n_perm):
        s = rng.randrange(MIN_SHIFT, n - MIN_SHIFT); sh = lead[s:] + lead[:s]
        for k in lags:
            vals[k].append(abs(pearson(sh[:n - k] if k > 0 else sh, tgt[k:] if k > 0 else tgt)))
    return {k: sorted(v)[int(0.95 * n_perm)] for k, v in vals.items()}

def ols_r2(X, y):
    """R^2 of OLS with intercept included in X; normal equations by Gaussian elimination."""
    p = len(X[0]); A = [[sum(X[i][a] * X[i][b] for i in range(len(y))) for b in range(p)] for a in range(p)]
    c = [sum(X[i][a] * y[i] for i in range(len(y))) for a in range(p)]
    for i in range(p):
        piv = max(range(i, p), key=lambda r: abs(A[r][i])); A[i], A[piv] = A[piv], A[i]; c[i], c[piv] = c[piv], c[i]
        for r in range(i + 1, p):
            f = A[r][i] / A[i][i]
            for q in range(i, p): A[r][q] -= f * A[i][q]
            c[r] -= f * c[i]
    beta = [0.0] * p
    for i in range(p - 1, -1, -1):
        beta[i] = (c[i] - sum(A[i][q] * beta[q] for q in range(i + 1, p))) / A[i][i]
    my = sum(y) / len(y)
    sst = sum((v - my) ** 2 for v in y)
    sse = sum((y[i] - sum(beta[q] * X[i][q] for q in range(p))) ** 2 for i in range(len(y)))
    return 1 - sse / sst, beta

def incremental_r2(lead, tgt, k, own_lags=(7, 14), n_perm=500, seed=SEED):
    """Does lead[t-k] add explanatory power for tgt[t] beyond tgt's own lags? Delta R^2 with circular-shift p-value (k fixed in advance)."""
    start = max(i for i, v in enumerate(lead) if v is None) + 1 if None in lead else 0
    start = max(start, max(i for i, v in enumerate(tgt) if v is None) + 1 if None in tgt else 0)
    first = start + max(k, *own_lags)
    idx = list(range(first, len(tgt)))
    y = [tgt[t] for t in idx]
    base = [[1.0] + [tgt[t - l] for l in own_lags] for t in idx]
    r2_base, _ = ols_r2(base, y)
    def with_lead(series):
        return ols_r2([row + [series[t - k]] for row, t in zip(base, idx)], y)
    r2_full, beta = with_lead(lead)
    rng = random.Random(seed + 2); n = len(lead); ge = 0
    for _ in range(n_perm):
        s = rng.randrange(MIN_SHIFT, n - MIN_SHIFT)
        sh = lead[s:] + lead[:s]
        if None in sh[first - k:]:
            sh = [v if v is not None else 0.0 for v in sh]
        if with_lead(sh)[0] - r2_base >= r2_full - r2_base: ge += 1
    return {"k": k, "n": len(idx), "r2_base": r2_base, "r2_full": r2_full, "delta_r2": r2_full - r2_base,
            "beta_lead": beta[-1], "p_perm": (1 + ge) / (1 + n_perm)}

def to_date(s): return datetime.date.fromisoformat(s)

BREAK = "2026-04-02"   # day the data itself shows the dust-transaction collapse (largest 14-day-over-14-day change in tx_total)
HYP_LEAD, HYP_TARGET, FIXED_K = "tx_intents", "signers_ex_intents", 7

def compute():
    u = load("daily_usage.csv"); dates = [r["block_date"] for r in u]
    col = lambda n: [float(r[n]) for r in u]
    S = {n: col(n) for n in ("tx_total", "tx_intents", "signers_total", "signers_ex_intents", "receivers_ex_intents", "intents_signers", "signers_multi")}
    S["tx_ex_intents"] = [a - b for a, b in zip(S["tx_total"], S["tx_intents"])]
    Z = {n: weekly_log_change([max(v, 1.0) for v in s]) for n, s in S.items()}
    bi = dates.index(BREAK); R = {"dates": dates, "series": S, "break_index": bi}
    lags = list(range(1, MAX_LAG + 1))
    def sl(z, a, b): return z[a:b]
    regimes = {"full": (0, len(dates)), "pre_break": (0, bi), "post_break": (bi + 13, len(dates))}
    # primary + reverse
    R["primary"], R["reverse"], R["bands"] = {}, {}, {}
    for name, (a, b) in regimes.items():
        lead, tgt = sl(Z[HYP_LEAD], a, b), sl(Z[HYP_TARGET], a, b)
        R["primary"][name] = ccf_test(lead, tgt)
        R["reverse"][name] = ccf_test(tgt, lead)
        R["bands"][name] = {"fwd": lag_band(lead, tgt, lags), "rev": lag_band(tgt, lead, lags)}
    # leaders compared on the full window, target = DAU ex intents
    R["leaders"] = {}
    for n in ("tx_intents", "intents_signers", "signers_multi", "receivers_ex_intents", "tx_ex_intents"):
        t = ccf_test(Z[n], Z[HYP_TARGET]); R["leaders"][n] = {k: t[k] for k in ("n", "best_lag", "best_r", "p_perm", "null95")}
    # robustness target
    t = ccf_test(Z[HYP_LEAD], Z["signers_multi"]); R["robust_target"] = {k: t[k] for k in ("n", "best_lag", "best_r", "p_perm", "null95")}
    # incremental explanatory power at a pre-set lag
    R["incremental"] = incremental_r2(Z[HYP_LEAD], Z[HYP_TARGET], FIXED_K)
    # descriptive levels by month
    months = {}
    for i, d in enumerate(dates): months.setdefault(d[:7], []).append(i)
    R["monthly"] = {m: {"days": len(ix), **{n: sum(S[n][i] for i in ix) / len(ix) for n in S}} for m, ix in months.items()}
    for m in R["monthly"].values(): m["intents_share_pct"] = 100 * m["tx_intents"] / m["tx_total"]
    # sampled-day Intents events
    e = load("intents_events_sample.csv"); R["events"] = e
    ec = lambda n: [float(r[n]) for r in e]
    tx_on_sample = [S["tx_intents"][dates.index(r["block_date"])] for r in e]
    usd = ec("stable_pos_usd")
    R["validation"] = {"n": len(e),
        "pearson_tx_vs_usd": pearson(tx_on_sample, usd), "spearman_tx_vs_usd": spearman(tx_on_sample, usd),
        "pearson_tokendiff_vs_usd": pearson(ec("ev_token_diff"), usd), "spearman_tokendiff_vs_usd": spearman(ec("ev_token_diff"), usd),
        "tx_on_sample": tx_on_sample}
    srt = sorted(usd); R["usd"] = {"min": srt[0], "median": srt[len(srt) // 2], "max": srt[-1],
        "first_third_median": sorted(usd[:len(usd)//3])[len(usd)//6], "last_third_median": sorted(usd[-(len(usd)//3):])[len(usd)//6],
        "post_break_median": sorted([u_ for r, u_ in zip(e, usd) if r["block_date"] >= BREAK])[len([1 for r in e if r["block_date"] >= BREAK]) // 2]}
    R["factory"] = load("account_creation_parents_sample.csv")
    return R
