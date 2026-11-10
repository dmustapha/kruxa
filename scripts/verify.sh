#!/usr/bin/env bash
# Judge entry point. No keys, no funds.
#   ./scripts/verify.sh golden                         offline: recompute the documented vectors
#   ./scripts/verify.sh chain <rpc> <contract> <id>    recompute a live launch's verdict from its public views
#   ./scripts/verify.sh chain <rpc> <contract> <id> --tamper [field]   flips one unit of a recorded input; MUST print MISMATCH <field>
#   ./scripts/verify.sh chain <rpc> <contract> <id> --tamper-all       every recorded input, one run each; MISMATCH line per field
#   optional on chain: --rpc2 <url> reads every view from a second RPC too; disagreement is an infrastructure error
#   ./scripts/verify.sh <launch_id> [--tamper-all] [--rpc2 <url>] [--charter FILE] [--production]
#        full judge run: NEAR recompute (C31-C34 via kruxa-sim), the KEYS and CODE lines, and the Solana checks C3-C28 from
#        evidence/genesis-<id>.json (or $KRUXA_GENESIS_PREFIX<id>.json). Env: KRUXA_NEAR_RPC (testnet default), KRUXA_CONTRACT (core.kruxa.testnet), SOL_DEVNET_RPC.
#   ./scripts/verify.sh solana --record FILE --rpc URL ...     Solana checks only (scripts/verify_solana.py --help text)
#   ./scripts/verify.sh near-ops --rpc URL --contract ACCOUNT  the KEYS: and CODE: lines only (VX-2, CO-6 E-5)
#   ./scripts/verify.sh --evidence FILE [--tamper-all]         replay recorded Solana responses; prints "RECORDED, not live"
# Exit codes (CO-6 E-4): 0 MATCH, 2 ONLY a MISMATCH, 3 pending (not settled), 4 RPC or view failure, 64 usage,
#   1 a tamper run was NOT detected. A dead RPC can never print MISMATCH or exit 2.
set -euo pipefail
cd "$(dirname "$0")/.."
SIM="cargo run -q -p kruxa-sim --"

# Worst exit wins: infrastructure (4) > undetected tamper (1) > mismatch (2) > pending (3) > ok (0). An infrastructure failure anywhere
# must not be hidden by a clean part, and 2 stays reserved for a real mismatch.
worst() { local r=0 c; for c in "$@"; do case "$c" in 4) echo 4; return;; esac; done
  for c in "$@"; do [ "$c" = 1 ] && { echo 1; return; }; done
  for c in "$@"; do [ "$c" = 64 ] && { echo 64; return; }; done
  for c in "$@"; do [ "$c" = 2 ] && { echo 2; return; }; done
  for c in "$@"; do [ "$c" = 3 ] && { echo 3; return; }; done; echo "$r"; }

full_run() {
  local id="$1"; shift
  local tamper="" rpc2="" charter="" prod=""
  while [ "$#" -gt 0 ]; do case "$1" in
    --tamper-all) tamper=--tamper-all ;;
    --production) prod=--production ;;
    --rpc2) [ "$#" -ge 2 ] || { echo "usage: --rpc2 needs a URL" >&2; exit 64; }; rpc2="$2"; shift ;;
    --charter) [ "$#" -ge 2 ] || { echo "usage: --charter needs a file" >&2; exit 64; }; charter="$2"; shift ;;
    *) echo "usage: $0 <launch_id> [--tamper-all] [--rpc2 <url>] [--charter FILE] [--production]" >&2; exit 64 ;;
  esac; shift; done
  local near="${KRUXA_NEAR_RPC:-https://test.rpc.fastnear.com}" contract="${KRUXA_CONTRACT:-core.kruxa.testnet}"
  local sol="${SOL_DEVNET_RPC:-https://api.devnet.solana.com}" rec="${KRUXA_GENESIS_PREFIX:-evidence/genesis-}$id.json"
  local c_near c_ops c_sol
  echo "== NEAR recompute (C31-C34, kruxa-sim)"
  set +e
  sim_out=$($SIM verify --rpc "$near" --contract "$contract" --launch "$id" ${tamper:+$tamper} ${rpc2:+--rpc2 "$rpc2"} 2>&1); c_near=$?
  printf '%s\n' "$sim_out"
  echo "== operator lines (VX-2)"
  python3 -I scripts/verify_near_ops.py --rpc "$near" --contract "$contract" --sums artifacts/SHA256SUMS; c_ops=$?
  echo "== Solana genesis (C3-C28)"
  if [ -f "$rec" ]; then
    local vm=""
    if [ "$c_near" = 0 ] && printf '%s\n' "$sim_out" | grep -q "recomputed outcome=PASS" && printf '%s\n' "$sim_out" | grep -q "^MATCH"; then vm="MATCH"; fi
    python3 -I scripts/verify_solana.py --record "$rec" --rpc "$sol" --near-rpc "$near" --contract "$contract" --launch "$id" ${vm:+--near-verdict "$vm"} ${rpc2:+--rpc2 "$rpc2"} ${tamper:+$tamper} ${charter:+--charter "$charter"} ${prod:+$prod}; c_sol=$?
  else
    if [ "$c_near" = 0 ] && printf '%s\n' "$sim_out" | grep -q "recomputed outcome=FAIL"; then
      echo "no mint (expected for FAIL): launch $id failed its verdict, so no Solana genesis exists"
      python3 -I scripts/verify_solana.py --c30 --near-rpc "$near" --contract "$contract" --launch "$id"; c_sol=$?
    else
      echo "PENDING: no $rec (genesis record not published yet)"; c_sol=3
    fi
  fi
  set -e
  exit "$(worst "$c_near" "$c_ops" "$c_sol")"
}
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
  solana) shift; exec python3 -I scripts/verify_solana.py "$@" ;;
  near-ops) shift; exec python3 -I scripts/verify_near_ops.py "$@" ;;
  --evidence) shift; exec python3 -I scripts/verify_solana.py --evidence "$@" ;;
  [0-9]*) shift_id="$1"; shift; full_run "$shift_id" "$@" ;;
  *) echo "usage: $0 golden | <launch_id> [--tamper-all] | solana ... | near-ops ... | --evidence FILE | chain <rpc> <contract> <launch_id> [--tamper [field] | --tamper-all] [--rpc2 <url>]" >&2; exit 64 ;;
esac
