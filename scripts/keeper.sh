#!/usr/bin/env bash
# Keeper (C15, scripts only in Wave 1): runs the permissionless methods for one launch in the only order that works.
# Prints the commands by default; executes only with --yes and NEAR_ENV=testnet. Mainnet is refused.
#   KRUXA_CORE=core.kruxa.testnet KRUXA_KEEPER=keeper.kruxa.testnet ./scripts/keeper.sh 1 [--yes]
set -euo pipefail
CORE="${KRUXA_CORE:?set KRUXA_CORE}"; SIGNER="${KRUXA_KEEPER:?set KRUXA_KEEPER}"; ID="${1:?launch id}"
if [ "${NEAR_ENV:-testnet}" = "mainnet" ] || [[ "$CORE" != *.testnet ]]; then echo "refusing: testnet only"; exit 1; fi
RUN=false; [ "${2:-}" = "--yes" ] && [ "${NEAR_ENV:-}" = "testnet" ] && RUN=true
call() { # method, json args
  local cmd="near contract call-function as-transaction $CORE $1 json-args '$2' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as $SIGNER network-config testnet sign-with-keychain send"
  echo "$cmd"; if $RUN; then bash -c "$cmd"; fi
}
unsettled() { near contract call-function as-read-only "$CORE" get_state json-args "{\"launch_id\":\"$ID\"}" network-config testnet now \
  | python3 -c 'import json,re,sys; print(json.loads(re.search(r"\{.*\}", sys.stdin.read(), re.S).group(0))["positions_unsettled"])'; }
call settle "{\"launch_id\":\"$ID\"}"
SEQ=0
while true; do
  call settle_positions_page "{\"launch_id\":\"$ID\",\"from_seq\":$SEQ,\"limit\":25}"
  SEQ=$((SEQ + 25))
  if ! $RUN || [ "$(unsettled)" = "0" ] || [ "$SEQ" -gt 600 ]; then break; fi
done
for m in sweep_residue consolidate pay_launch_fee pay_relay_fees; do call "$m" "{\"launch_id\":\"$ID\"}"; done
$RUN || echo "(dry run: pass --yes with NEAR_ENV=testnet to execute; later steps fail until earlier ones finish, which is expected)"
