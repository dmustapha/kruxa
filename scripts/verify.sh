#!/usr/bin/env bash
# Judge entry point. No keys, no funds.
#   ./scripts/verify.sh golden                         offline: recompute the documented vectors
#   ./scripts/verify.sh chain <rpc> <contract> <id>    recompute a live launch's verdict from its public views
#   ./scripts/verify.sh chain <rpc> <contract> <id> --tamper   flips one unit of the recorded inputs; MUST print MISMATCH
set -euo pipefail
cd "$(dirname "$0")/.."
SIM="cargo run -q -p kruxa-sim --"
case "${1:-}" in
  golden)
    echo "== boundary: total == soft cap and funders == min  -> PASS"
    $SIM verdict --launch-id 1 --total-active 350000000 --funders 10 --soft-cap 350000000 --min-funders 10
    echo "== one micro-USDC below the soft cap               -> FAIL(reasons=1)"
    $SIM verdict --launch-id 1 --total-active 349999999 --funders 10 --soft-cap 350000000 --min-funders 10
    echo "== S1-B example 1: 12,500 USDC against a 5,000 USDC cap, one 100 USDC buyer pays 40 and is refunded 60"
    $SIM settle --total-active 12500000000 --hard-cap 5000000000 --commit 100000000
    ;;
  chain)
    shift
    $SIM verify --rpc "$1" --contract "$2" --launch "$3" ${4:+"$4"}
    ;;
  *) echo "usage: $0 golden | chain <rpc> <contract> <launch_id> [--tamper]"; exit 2 ;;
esac
