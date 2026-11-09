"""Offline rebuild: verify snapshot hashes, rerun analysis, write charts, dashboard/index.html, results/results.json and THESIS.md.
Stdlib only. Prints one sha256 per snapshot and per chart and ends with THESIS OK."""
import datetime, hashlib, html, json, os, re, sys
import analysis as A, charts as C

HERE = os.path.dirname(os.path.abspath(__file__))
def sha(b): return hashlib.sha256(b).hexdigest()
def n0(v): return f"{v:,.0f}"
def r3(v): return f"{v:.3f}"
def usd(v): return f"${v/1e6:,.1f}M"
def sql_of(name): return open(os.path.join(HERE, "queries", name)).read()

def verify_snapshots():
    man = json.load(open(os.path.join(HERE, "snapshots", "MANIFEST.json")))
    for name, m in sorted(man.items()):
        h = sha(open(os.path.join(HERE, "snapshots", name), "rb").read())
        qh = sha(open(os.path.join(HERE, m["query_file"]), "rb").read())
        if h != m["sha256"]: sys.exit(f"SNAPSHOT MISMATCH {name}: {h} != {m['sha256']}")
        note = "" if qh == m["query_sha256"] else "  (query file changed since pull: re-run make thesis-live)"
        print(f"SNAPSHOT {name} sha256={h} pulled_on={m['pulled_on']} window={m['window']}{note}")
    return man

def month_mean(R, m, k): return R["monthly"][m][k]

def values(R):
    d = R["dates"]; S = R["series"]; M = R["monthly"]; months = sorted(M)
    first_m, last_m = months[0], months[-1]; last_full = months[-2] if M[last_m]["days"] < 28 else last_m
    P, Rv = R["primary"], R["reverse"]; ev = R["events"]; V = R["validation"]
    bi = R["break_index"]
    avg = lambda k, a, b: sum(S[k][a:b]) / (b - a)
    burst = max(range(len(ev)), key=lambda i: float(ev[i]["ev_token_diff"]) if False else V["tx_on_sample"][i])
    usd_by = [float(r["stable_pos_usd"]) for r in ev]
    ledger = json.load(open(os.path.join(HERE, "query-ledger.json")))["entries"]
    fac = R["factory"]; ex = next(r for r in fac if "launchpad" in r["parent_account"])
    ra = next(e for e in ledger if e["label"] == "factory_probe")
    z = {}
    z.update(win_start=d[0], win_end=d[-1], n_days=P["full"]["n"], n_perm=A.N_PERM, min_shift=A.MIN_SHIFT, sample_step=20)
    z.update(p_full_r=r3(P["full"]["best_r"]), p_full_lag=P["full"]["best_lag"], p_full_p=f"{P['full']['p_perm']:.3f}", p_full_null=r3(P["full"]["null95"]),
             null_pct=f"{100*P['full']['p_perm']:.0f}",
             inc_delta=f"{R['incremental']['delta_r2']:.4f}", inc_p=f"{R['incremental']['p_perm']:.3f}")
    z.update(first_month=first_m, last_full_month=last_full, last_month=last_m, last_month_days=M[last_m]["days"],
             share_first=f"{M[first_m]['intents_share_pct']:.1f}", share_last_full=f"{M[last_full]['intents_share_pct']:.1f}", share_last=f"{M[last_m]['intents_share_pct']:.1f}",
             tx_i_first=n0(M[first_m]["tx_intents"]), tx_i_last_full=n0(M[last_full]["tx_intents"]),
             dau_first=n0(M[first_m]["signers_ex_intents"]), dau_last_full=n0(M[last_full]["signers_ex_intents"]))
    z.update(n_samples=len(ev), usd_median=usd(R["usd"]["median"]), usd_min=usd(R["usd"]["min"]), usd_max=usd(R["usd"]["max"]),
             usd_first=usd(R["usd"]["first_third_median"]), usd_last=usd(R["usd"]["last_third_median"]),
             hex_first=n0(float(ev[0]["accts_hex64"])), hex_first_day=ev[0]["block_date"], hex_last=n0(float(ev[-1]["accts_hex64"])), hex_last_day=ev[-1]["block_date"])
    z.update(break_date=d[bi], tx_before=n0(avg("tx_total", bi - 7, bi)), tx_after=n0(avg("tx_total", bi, bi + 7)),
             rcv_before=n0(avg("receivers_ex_intents", bi - 7, bi)), rcv_after=n0(avg("receivers_ex_intents", bi, bi + 7)),
             sig_before=n0(avg("signers_ex_intents", bi - 7, bi)), sig_after=n0(avg("signers_ex_intents", bi, bi + 7)))
    z.update(post_n=Rv["post_break"]["n"], rev_post_r=r3(Rv["post_break"]["best_r"]), rev_post_lag=Rv["post_break"]["best_lag"], rev_post_p=f"{Rv['post_break']['p_perm']:.3f}",
             rev_edge_note=("at the edge of the allowed 1 to 28 day range, which suggests a slow common movement rather than a clean lag" if Rv["post_break"]["best_lag"] >= 27 else "inside the allowed range"))
    z.update(val_pearson=r3(V["pearson_tx_vs_usd"]), val_spearman=r3(V["spearman_tx_vs_usd"]), burst_day=ev[burst]["block_date"], burst_tx=n0(V["tx_on_sample"][burst]),
             burst_usd=usd(usd_by[burst]), burst_named=n0(float(ev[burst]["accts_named"])))
    z["leaders_table"] = "; ".join(f"`{k}` r = {r3(v['best_r'])} at {v['best_lag']} days, p = {v['p_perm']:.3f}" for k, v in R["leaders"].items()) + "."
    z.update(factory_day="2026-10-15", factory_example=ex["parent_account"], factory_example_n=ex["accounts_created"], factory_top=fac[0]["accounts_created"], factory_top_name=fac[0]["parent_account"], ra_gb_day=f"{ra['bytes']/1e9:.1f}")
    z.update(ledger_gb=f"{sum(e['bytes'] for e in ledger)/1e9:.1f}", ledger_n=len(ledger))
    a = P["full"]["p_perm"] < 0.05 and P["full"]["best_r"] > 0
    b = P["pre_break"]["best_r"] > 0 and P["post_break"]["best_r"] > 0
    c = Rv["full"]["best_r"] < P["full"]["best_r"] and Rv["post_break"]["p_perm"] >= 0.05
    dd = R["incremental"]["p_perm"] < 0.05 and R["incremental"]["delta_r2"] > 0
    ok = lambda t: "met" if t else "not met"
    z.update(res_a=ok(a), res_b=f"{ok(b)} (pre-break r = {r3(P['pre_break']['best_r'])}, p = {P['pre_break']['p_perm']:.3f}; post-break r = {r3(P['post_break']['best_r'])}, p = {P['post_break']['p_perm']:.3f})",
             res_c=f"{ok(c)} (reverse full-window r = {r3(Rv['full']['best_r'])}, p = {Rv['full']['p_perm']:.3f}; reverse post-break p = {Rv['post_break']['p_perm']:.3f})", res_d=ok(dd))
    checks = [("verdict 'not supported' needs full-window p >= 0.05", P["full"]["p_perm"] >= 0.05),
              ("'none clears p < 0.05' for other leaders", all(v["p_perm"] >= 0.05 for v in R["leaders"].values())),
              ("later third of notional above earlier third", R["usd"]["last_third_median"] > R["usd"]["first_third_median"]),
              ("Intents share rose first to last full month", M[last_full]["intents_share_pct"] > M[first_m]["intents_share_pct"]),
              ("base usage fell first to last full month", M[last_full]["signers_ex_intents"] < M[first_m]["signers_ex_intents"]),
              ("tx proxy does not track notional well (Pearson < 0.5)", V["pearson_tx_vs_usd"] < 0.5),
              ("signers barely moved at the break (within 10 percent)", abs(avg('signers_ex_intents', bi, bi+7) / avg('signers_ex_intents', bi-7, bi) - 1) < 0.10),
              ("tx_total fell at the break", avg("tx_total", bi, bi + 7) < 0.5 * avg("tx_total", bi - 7, bi))]
    bad = [t for t, ok_ in checks if not ok_]
    if bad: sys.exit("PROSE OUT OF DATE, re-read THESIS.template.md: " + "; ".join(bad))
    return z

def chart_set(R):
    dates = [datetime.date.fromisoformat(x) for x in R["dates"]]; S = R["series"]; bi = R["break_index"]; ev = R["events"]
    lags = list(range(1, A.MAX_LAG + 1)); P, Rv, B = R["primary"], R["reverse"], R["bands"]
    last = R["dates"][-1]; vl = [(bi, "dust break")]
    out = []
    def add(cid, title, svg, reading, sql, snap, through): out.append(dict(id=cid, title=title, svg=svg, reading=reading, sql=sql, snap=snap, through=through))
    M = R["monthly"]; months = sorted(M)
    add("daily_active", "Daily active signer accounts", C.line_chart(dates, [("signers excluding intents.near calls", S["signers_ex_intents"]), ("signers hitting 3+ contracts", S["signers_multi"])], "accounts per day (log)", "Daily active signer accounts", "Line chart, log scale", logy=True, vlines=vl),
        f"Daily active signers fell from {n0(M[months[0]]['signers_ex_intents'])} (monthly mean, {months[0]}) to {n0(M[months[-2]]['signers_ex_intents'])} ({months[-2]}), and signers touching at least 3 contracts moved from {n0(M[months[0]]['signers_multi'])} to {n0(M[months[-2]]['signers_multi'])}.", "01_daily_usage.sql", "daily_usage.csv", last)
    add("tx_counts", "Transactions per day: all versus to intents.near", C.line_chart(dates, [("all transactions", S["tx_total"]), ("to intents.near", S["tx_intents"])], "transactions per day (log)", "Transactions per day", "Line chart, log scale", logy=True, vlines=vl),
        f"All transactions dropped on {R['dates'][bi]} from about {n0(sum(S['tx_total'][bi-7:bi])/7)} to about {n0(sum(S['tx_total'][bi:bi+7])/7)} per day while transactions to intents.near stayed in the tens of thousands.", "01_daily_usage.sql", "daily_usage.csv", last)
    add("intents_share", "Intents share of NEAR transactions, by month", C.bar_chart([m[2:] for m in months], [M[m]["intents_share_pct"] for m in months], "percent of transactions", "Intents share of transactions", "Bar chart by month"),
        f"intents.near was {M[months[0]]['intents_share_pct']:.1f} percent of transactions in {months[0]} and {M[months[-2]]['intents_share_pct']:.1f} percent in {months[-2]}, partly because the rest of the activity shrank. The last bar is a partial month ({M[months[-1]]['days']} days).", "01_daily_usage.sql", "daily_usage.csv", last)
    add("contract_breadth", "Distinct receiver accounts per day (contract usage breadth)", C.line_chart(dates, [("distinct receivers excluding intents.near", S["receivers_ex_intents"])], "receiver accounts per day (log)", "Distinct receiver accounts", "Line chart, log scale", logy=True, vlines=vl),
        f"Distinct receiver accounts fell about {100*(1-sum(S['receivers_ex_intents'][bi:bi+7])/sum(S['receivers_ex_intents'][bi-7:bi])):.0f} percent in one step on {R['dates'][bi]}, the same day total transactions collapsed, which points to a single dust source rather than organic decline.", "01_daily_usage.sql", "daily_usage.csv", last)
    add("leadlag_full", "H1 test: does intents.near activity lead active accounts? (full window)", C.lag_chart(lags, [("corr(Intents growth at t, active-account growth at t+lag)", P["full"]["r_by_lag"])], B["full"]["fwd"], "correlation", "Lead-lag correlation, full window", "Correlation by lag with a shaded 95 percent chance band"),
        f"The best lead is r = {r3(P['full']['best_r'])} at {P['full']['best_lag']} days, inside the chance band (permutation p = {P['full']['p_perm']:.3f}), so H1 is not supported.", "01_daily_usage.sql", "daily_usage.csv", last)
    add("leadlag_reverse_post", "Reverse direction after the break: do active accounts lead intents.near? (exploratory)", C.lag_chart(lags, [("corr(active-account growth at t, Intents growth at t+lag)", Rv["post_break"]["r_by_lag"])], B["post_break"]["rev"], "correlation", "Reverse lead-lag, post break", "Correlation by lag with a shaded 95 percent chance band"),
        f"After {R['dates'][bi]} active-account growth correlates with later Intents growth up to r = {r3(Rv['post_break']['best_r'])} at {Rv['post_break']['best_lag']} days (p = {Rv['post_break']['p_perm']:.3f}); the peak sits at the edge of the lag range, so read it as a slow shared movement, not a mechanism.", "01_daily_usage.sql", "daily_usage.csv", last)
    lead_names = list(R["leaders"])
    add("leaders", "Other candidate leaders versus Intents (best lead r, full window)", C.bar_chart(lead_names, [R["leaders"][k]["best_r"] for k in lead_names], "best r at lag 1 to 28", "Best lead correlation by candidate leader", "Bar chart of best correlation per leader"),
        "No candidate leader clears its chance threshold: " + "; ".join(f"{k} p = {R['leaders'][k]['p_perm']:.2f}" for k in lead_names) + ".", "01_daily_usage.sql", "daily_usage.csv", last)
    days = [r["block_date"][2:] for r in ev]; usd_ = [float(r["stable_pos_usd"]) / 1e6 for r in ev]
    add("stable_notional", "Stablecoin-leg swap notional on sampled days (USD millions)", C.bar_chart(days, usd_, "USD millions per day", "Stablecoin-leg swap notional", "Bar chart by sampled day"),
        f"On {len(ev)} sampled days the median stablecoin-leg notional was {usd(R['usd']['median'])} (range {usd(R['usd']['min'])} to {usd(R['usd']['max'])}); it counts only swaps with a named USDC or USDT leg and double counts stable-to-stable swaps.", "02_intents_events_sample.sql", "intents_events_sample.csv", ev[-1]["block_date"])
    add("proxy_check", "Is transaction count a good proxy for value? (sampled days)", C.scatter(R["validation"]["tx_on_sample"], usd_, "transactions to intents.near that day", "stablecoin-leg notional, USD millions", "Transactions versus notional", "Scatter plot, one point per sampled day"),
        f"Pearson correlation between transactions to intents.near and stablecoin-leg notional is {r3(R['validation']['pearson_tx_vs_usd'])} (Spearman {r3(R['validation']['spearman_tx_vs_usd'])}) over {len(ev)} days, so transaction counts are a weak stand-in for value.", "02_intents_events_sample.sql", "intents_events_sample.csv", ev[-1]["block_date"])
    add("accounts", "Distinct 64-hex (implicit) accounts in token_diff events, sampled days", C.bar_chart(days, [float(r["accts_hex64"]) for r in ev], "accounts", "Implicit accounts in swap events", "Bar chart by sampled day"),
        f"Implicit accounts in swap events rose from {n0(float(ev[0]['accts_hex64']))} to {n0(float(ev[-1]['accts_hex64']))} between the first and last sampled day, with one-off spikes of named accounts on the campaign days; this is a ceiling on users, because solvers can use implicit accounts too.", "02_intents_events_sample.sql", "intents_events_sample.csv", ev[-1]["block_date"])
    fac = R["factory"][:15]
    add("factory_sample", "Accounts created per parent account, one day (2026-10-15)", C.bar_chart([r["parent_account"][:18] for r in fac], [float(r["accounts_created"]) for r in fac], "accounts created", "Accounts created by parent", "Bar chart, top 15 parents on one day"),
        f"On one day the largest parent created {fac[0]['accounts_created']} accounts and the launch-like parents are in the tens, so token-factory activity is not visible at scale in this sample; it is one day, not a trend.", "03_account_creation_parents_sample.sql", "account_creation_parents_sample.csv", "2026-10-15")
    return out

CSS = """:root{--bg:#fbfaf7;--fg:#1c1b19;--mut:#5e5b55;--card:#fff;--line:#dcd8cf;--c1:#1f5fbf;--c2:#c2410c;--c3:#2f7d4f;--c4:#7a3fa0;--band:rgba(120,120,120,.18)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14130f;--fg:#ece9e1;--mut:#a29e94;--card:#1d1b16;--line:#38352d;--c1:#6ea8ff;--c2:#ff9a5c;--c3:#6fcf97;--c4:#c79bff;--band:rgba(200,200,200,.15)}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:820px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem}h2{font-size:1.05rem;margin:0 0 6px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:18px 0}
svg{width:100%;height:auto}.tick{font-size:11px;fill:var(--mut)}.axis{stroke:var(--mut);stroke-width:1}.grid{stroke:var(--line);stroke-width:1}.vline{stroke:var(--mut);stroke-dasharray:4 3}.band{fill:var(--band)}
.read{margin:6px 0}.meta{color:var(--mut);font-size:.85rem}details{margin-top:6px}pre{overflow:auto;background:var(--bg);border:1px solid var(--line);padding:10px;font-size:.78rem;border-radius:6px;white-space:pre-wrap}code{font-size:.85rem}a{color:var(--c1)}"""

def dashboard(R, cs, hashes, man):
    parts = [f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>NEAR Thesis Dashboard</title><style>{CSS}</style></head><body><main>",
             f"<h1>NEAR thesis dashboard</h1><p class=meta>Data: public BigQuery dataset crypto_near_mainnet_us, block dates {R['dates'][0]} to {R['dates'][-1]}. Rebuilt offline by <code>make thesis</code> from committed snapshots; no network calls. Verdict and caveats: see THESIS.md.</p>"]
    for c in cs:
        m = man[c["snap"]]
        parts.append(f"<section class=card id={c['id']}><h2>{html.escape(c['title'])}</h2>{c['svg'].replace(' xmlns="http://www.w3.org/2000/svg"', '')}<p class=read><strong>Reading.</strong> {html.escape(c['reading'])}</p>"
                     f"<p class=meta>Data through {c['through']} &middot; snapshot <code>snapshots/{c['snap']}</code> sha256 <code>{m['sha256'][:16]}</code> &middot; chart sha256 <code>{hashes[c['id']][:16]}</code></p>"
                     f"<details><summary>Query: queries/{c['sql']}</summary><pre>{html.escape(sql_of(c['sql']))}</pre></details></section>")
    parts.append("</main></body></html>")
    return "".join(parts)

BANNED = ["revolutionary", "seamless", "cutting-edge", "world-class", "blazing-fast", "unparalleled", "game-changing", "next-generation", "effortless", "magical", "best-in-class", "paradigm-shift"]

def main():
    man = verify_snapshots()
    R = A.compute()
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True); os.makedirs(os.path.join(HERE, "dashboard", "charts"), exist_ok=True)
    slim = {k: v for k, v in R.items() if k not in ("series", "dates", "events", "factory")}
    for reg in slim["primary"].values(): reg["r_by_lag"] = {str(k): round(v, 6) for k, v in reg["r_by_lag"].items()}
    for reg in slim["reverse"].values(): reg["r_by_lag"] = {str(k): round(v, 6) for k, v in reg["r_by_lag"].items()}
    open(os.path.join(HERE, "results", "results.json"), "w").write(json.dumps(slim, indent=1, sort_keys=True, default=str))
    z = values(R); cs = chart_set(R); hashes = {}
    for c in cs:
        data = c["svg"].encode(); hashes[c["id"]] = sha(data)
        open(os.path.join(HERE, "dashboard", "charts", c["id"] + ".svg"), "wb").write(data)
        print(f"CHART {c['id']} sha256={hashes[c['id']]}")
    page = dashboard(R, cs, hashes, man)
    open(os.path.join(HERE, "dashboard", "index.html"), "w").write(page)
    tpl = open(os.path.join(HERE, "THESIS.template.md")).read()
    text = re.sub(r"\{\{(\w+)\}\}", lambda m: str(z[m.group(1)]), tpl)
    if re.search(r"\{\{", text): sys.exit("unfilled placeholder")
    for w in BANNED:
        if w in (text + page).lower(): sys.exit(f"banned word: {w}")
    if "—" in text + page or "–" in text + page: sys.exit("em or en dash present")
    if re.search(r"https?://", page): sys.exit("dashboard contains an external URL")
    open(os.path.join(HERE, "THESIS.md"), "w").write(text)
    print(f"THESIS.md sha256={sha(text.encode())}")
    print("THESIS OK")

if __name__ == "__main__":
    main()
