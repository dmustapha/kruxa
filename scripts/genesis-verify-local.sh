#!/usr/bin/env bash
# End-to-end LOCAL rehearsal of genesis plus verify: starts the preloaded local validator, runs the F1 (or F0 sandbox) ceremony with a
# Squads reserve vault and a claim, then runs verify_solana.py: plain, --tamper-all, --evidence-out and replay, and the negative tests.
#   ./scripts/genesis-verify-local.sh [F1|F0]
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-F1}"
W="$(mktemp -d "${TMPDIR:-/tmp}/kruxa-verify.XXXXXX")"
trap 'rm -rf "$W"' EXIT
export W MODE
exec ./scripts/genesis-local.sh -- bash -c '
set -euo pipefail
export F0_BACKEND=sandbox
npx --prefix relayer tsx relayer/src/genesis-cli.ts --launch 1 --mode "$MODE" --cluster local --squads-time-lock 60 --claim-test --record "$W/record.json" | tail -n 6
python3 - <<PY
import json,os
r=json.load(open(os.environ["W"]+"/record.json"))
json.dump({"reserve_members":r["squads"]["members"],"time_lock":r["squads"]["time_lock"]},open(os.environ["W"]+"/charter.json","w"))
PY
V="python3 -I scripts/verify_solana.py --record $W/record.json --rpc http://127.0.0.1:28899 --commitment confirmed --charter $W/charter.json"
set +e
echo "== plain"; $V --evidence-out "$W/evidence.json"; echo "exit $?"
echo "== tamper-all"; $V --tamper-all; echo "exit $?"
echo "== evidence replay"; python3 -I scripts/verify_solana.py --evidence "$W/evidence.json" --tamper-all | head -n 3; echo "exit ${PIPESTATUS[0]}"
echo "== dead rpc + tamper-all"; python3 -I scripts/verify_solana.py --record "$W/record.json" --rpc http://127.0.0.1:9 --tamper-all; echo "exit $?"
echo "== bad flag"; python3 -I scripts/verify_solana.py --no-such-flag; echo "exit $?"
'
