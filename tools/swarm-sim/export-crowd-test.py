#!/usr/bin/env python3
"""Digest of the three committed swarm runs for the app's "Test your terms against a simulated crowd" panel.

  python3 -I tools/swarm-sim/export-crowd-test.py           write docs/interfaces/swarm-crowd-test.json
  python3 -I tools/swarm-sim/export-crowd-test.py --check   exit 1 if the committed digest no longer matches swarm/runs/run-1..3.json

Python 3 standard library only. Reads only committed files; no network. The digest keeps the mandatory SCRIPTED, RECORDED label
verbatim and the amounts as decimal strings of micro-USDC, as docs/interfaces/SWARM-OUTPUT.md requires.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = [ROOT / "swarm" / "runs" / f"run-{seed}.json" for seed in (1, 2, 3)]
OUT = ROOT / "docs" / "interfaces" / "swarm-crowd-test.json"


def digest(path: Path) -> dict:
    raw = path.read_bytes()
    run = json.loads(raw)
    s, a = run["settlement"], run["analysis"]
    return {
        "source": str(path.relative_to(ROOT)),
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "seed": run["seed"],
        "preset": run["preset"],
        "label": run["label"],
        "trial": {k: run["trial"][k] for k in ("soft_cap", "hard_cap", "min_funders", "wallet_cap", "rounds")},
        "verdict": s["verdict"],
        "total_committed": s["total_committed"],
        "funders": s["funders"],
        "margin_usdc": s["margin_usdc"],
        "oversubscription_bps": s["oversubscription_bps"],
        "invariants_held": run["invariants"]["held"],
        "rounds_checked": run["invariants"]["rounds_checked"],
        "price_parity": a["price_parity"],
        "adversaries_beat_honest": a["adversaries_beat_honest"],
        "blocked_by_rule": a["blocked_by_rule"],
        "bounded_not_blocked": [{"attack": b["attack"], "outcome": b["outcome"], "note": b["note"]} for b in a["bounded_not_blocked"]],
        "groups": [{k: g[k] for k in ("group", "agents", "committed", "fill_bps")} for g in run["groups"]],
    }


def build() -> str:
    doc = {
        "schema": "kruxa.swarm.crowd-test/1",
        "label": "SCRIPTED, RECORDED",
        "note": "Our own 16 scripted agents against the real verdict and allocation functions. Not a chain run, not model-driven. Sybil splitting and walk-to-flip are bounded, not blocked.",
        "runs": [digest(p) for p in RUNS],
    }
    return json.dumps(doc, indent=2) + "\n"


def main() -> int:
    text = build()
    if "--check" in sys.argv[1:]:
        if OUT.exists() and OUT.read_text() == text:
            print(f"crowd-test digest current: {OUT.relative_to(ROOT)} ({len(RUNS)} runs)")
            return 0
        print(f"crowd-test digest stale: rerun without --check to rewrite {OUT.relative_to(ROOT)}", file=sys.stderr)
        return 1
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)} from {len(RUNS)} committed runs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
