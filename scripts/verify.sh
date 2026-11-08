#!/usr/bin/env bash
# Judge entry point. No keys, no funds.
#   ./scripts/verify.sh golden                         offline: recompute the documented vectors
#   ./scripts/verify.sh chain <rpc> <contract> <id>    recompute a live launch's verdict from its public views
#   ./scripts/verify.sh chain <rpc> <contract> <id> --tamper [field]   flips one unit of a recorded input; MUST print MISMATCH <field>
#   ./scripts/verify.sh chain <rpc> <contract> <id> --tamper-all       every recorded input, one run each; MISMATCH line per field
#   optional on chain: --rpc2 <url> reads every view from a second RPC too; disagreement is an infrastructure error
# Exit codes (CO-6 E-4): 0 MATCH, 2 ONLY a MISMATCH, 3 pending (not settled), 4 RPC or view failure, 64 usage,
#   1 a tamper run was NOT detected. A dead RPC can never print MISMATCH or exit 2.
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
    [ "$#" -ge 3 ] || { echo "usage: $0 chain <rpc> <contract> <launch_id> [--tamper [field] | --tamper-all] [--rpc2 <url>]" >&2; exit 64; }
    rpc="$1" contract="$2" launch="$3"
    shift 3
    exec $SIM verify --rpc "$rpc" --contract "$contract" --launch "$launch" "$@"
    ;;
  *) echo "usage: $0 golden | chain <rpc> <contract> <launch_id> [--tamper [field] | --tamper-all] [--rpc2 <url>]" >&2; exit 64 ;;
esac
