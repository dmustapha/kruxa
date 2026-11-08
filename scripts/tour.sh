#!/usr/bin/env bash
# make tour: seven offline scenes that walk the launch rules end to end with the same binaries the judge path uses.
# No network, no keys, no chain. Each scene checks its own output and the tour ends `TOUR GREEN` only if all seven hold.
# Exit 0 green, 1 red. Called by scripts/judge-run.sh; also runs alone after `cargo build` (about a minute cold, seconds warm).
set -uo pipefail
cd "$(dirname "$0")/.."
export CARGO_NET_OFFLINE="${CARGO_NET_OFFLINE:-true}"
SIM="cargo run -q --locked -p kruxa-sim --"
bad=0

scene() { # <n> <label> <expected rc> <expected substring>... -- <cmd...>
  local n=$1 label=$2 want=$3; shift 3
  local exp=(); while [ "$1" != "--" ]; do exp+=("$1"); shift; done; shift
  local out rc; out=$("$@" 2>&1); rc=$?
  local ok=1; [ "$rc" -eq "$want" ] || ok=0
  local e; for e in "${exp[@]}"; do grep -qF -- "$e" <<<"$out" || ok=0; done
  local tag="TOUR $n/7"; [ "$n" = "+" ] && tag="         +"
  if [ "$ok" = 1 ]; then echo "$tag $label"; else echo "$tag RED $label (exit $rc, wanted $want)"; echo "$out" | tail -5 | sed 's/^/    /'; bad=1; fi
}

scene 1 "hostile preset refused: R_ALLOC R_WINDOW" 65 "R_ALLOC" "R_WINDOW" -- $SIM validate --params fixtures/hostile.json
scene 2 "standard preset accepted: no rule violated" 0 "OK: no rule violated" -- $SIM validate --params fixtures/standard.json
scene 3 "verdict at the boundary: PASS exactly at the soft cap" 0 "outcome=PASS" -- \
  $SIM verdict --launch-id 1 --total-active 350000000 --funders 10 --soft-cap 350000000 --min-funders 10
scene + "one micro-USDC below the soft cap: FAIL" 0 "outcome=FAIL(reasons=1)" -- \
  $SIM verdict --launch-id 1 --total-active 349999999 --funders 10 --soft-cap 350000000 --min-funders 10
scene 4 "oversubscribed 100 USDC buyer spends 40, refunded 60" 0 "spend=40000000 refund=60000000" -- \
  $SIM settle --total-active 12500000000 --hard-cap 5000000000 --commit 100000000
BOOK=$(cat fixtures/events/lifecycle.book_hash)
scene 5 "recorded lifecycle replays to the same book hash: MATCH" 0 "MATCH" -- \
  $SIM fold --events fixtures/events/lifecycle.jsonl --book-hash "$BOOK"
scene + "one micro-USDC changed in the record: MISMATCH, exit 2" 2 "MISMATCH" -- \
  $SIM fold --events fixtures/events/lifecycle.jsonl --book-hash "$BOOK" --tamper
scene 6 "market: fees split five ways, pool constant held" 0 "SLICES OK" -- cargo run -q --locked -p market-sim -- demo
scene + "market: creator never above 50% of the fee over 60 days" 0 "BOUND OK" -- cargo run -q --locked -p market-sim -- table 60
scene 7 "swarm: 16 agents, adversaries bounded, invariants hold every round" 0 "SWARM GREEN" "INVARIANTS HELD in 24 of 24 rounds" -- \
  cargo run -q --locked --offline -p swarm-sim -- run --seed 1

if [ "$bad" = 0 ]; then echo "TOUR GREEN"; exit 0; fi
echo "TOUR RED"; exit 1
