#!/usr/bin/env bash
# Task 2.2 / W1-DC-12 B-FACTORY: what does token.primitives.testnet really charge, does it refund the excess, does the token have ft_burn?
# TESTNET ONLY (play money). Needs: NEAR_BIN (near-cli-rs), HOME pointing at the keys dir, KRUXA_PROBE (a funded testnet account with its key there).
# Prints one `key=value` line per finding; `spent_near` is the deposit the factory kept, with gas separated out.
set -euo pipefail
NEAR="${NEAR_BIN:-near}"
PROBE="${KRUXA_PROBE:?set KRUXA_PROBE, a funded testnet account}"
FACTORY="${KRUXA_FACTORY:-token.primitives.testnet}"
SYMBOL="${KRUXA_PROBE_SYMBOL:-PRB$(date +%H%M%S)}"
ATTACH="${KRUXA_PROBE_DEPOSIT:-3}"
RPC=https://rpc.testnet.near.org
[[ "$PROBE" == *.testnet && "$FACTORY" == *.testnet && "${NEAR_ENV:-}" != mainnet ]] || { echo "refusing: testnet only"; exit 1; }
rpc() { curl -s -m 30 "$RPC" -H 'content-type: application/json' -d "$1"; }
balance() { rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"'"$1"'"}}' | jq -r .result.amount; }
near() { python3 -c "import sys;print(f'{int(sys.argv[1])/1e24:.6f}')" "$1"; }
has_method() { # view-call a method with empty args; MethodNotFound means it is not exported
  rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"'"$1"'","method_name":"'"$2"'","args_base64":"e30="}}' | jq -r '.result.error // "ok"' | grep -qv MethodNotFound
}
TOKEN="$(echo "$SYMBOL" | tr 'A-Z' 'a-z').$FACTORY"
echo "factory=$FACTORY code_hash=$(rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"'"$FACTORY"'"}}' | jq -r .result.code_hash)"
for m in create_token get_required_deposit; do has_method "$FACTORY" "$m" && echo "factory_method_$m=present" || echo "factory_method_$m=absent"; done
BEFORE=$(balance "$PROBE")
ARGS='{"args":{"owner_id":"'"$PROBE"'","total_supply":"1000000000000","metadata":{"spec":"ft-1.0.0","name":"Probe '"$SYMBOL"'","symbol":"'"$SYMBOL"'","decimals":6}}}'
OUT=$("$NEAR" contract call-function as-transaction "$FACTORY" create_token json-args "$ARGS" prepaid-gas '150 Tgas' attached-deposit "$ATTACH NEAR" sign-as "$PROBE" network-config testnet sign-with-legacy-keychain send 2>&1 | sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g')
TX=$(echo "$OUT" | grep -oE 'Transaction ID: [A-Za-z0-9]+' | head -1 | awk '{print $3}')
sleep 6
AFTER=$(balance "$PROBE")
echo "tx=$TX attached_near=$ATTACH"
STATUS=$(rpc '{"jsonrpc":"2.0","id":1,"method":"EXPERIMENTAL_tx_status","params":{"tx_hash":"'"$TX"'","sender_account_id":"'"$PROBE"'","wait_until":"FINAL"}}')
GAS_YOCTO=$(echo "$STATUS" | jq '[.result.transaction_outcome.outcome.tokens_burnt, (.result.receipts_outcome[].outcome.tokens_burnt)] | map(tonumber) | add')
DELTA=$(python3 -c "print(int('$BEFORE')-int('$AFTER'))")
KEPT=$(python3 -c "print(int('$DELTA')-int(float('$GAS_YOCTO')))")
echo "balance_delta_near=$(near "$DELTA") gas_burnt_near=$(near "${GAS_YOCTO%.*}") spent_near=$(near "$KEPT")"
python3 -c "print('refund_of_excess=' + ('yes' if int('$KEPT') < int(float('$ATTACH')*1e24) - 1e23 else 'no'))"
echo "token_account=$TOKEN exists=$(rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"'"$TOKEN"'"}}' | jq -r 'if .result then "yes" else "no" end')"
echo "$STATUS" | jq -r '.result.status | tostring | .[0:120]' | sed 's/^/tx_status=/'
echo "token_balance_of_owner=$(rpc '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"'"$TOKEN"'","method_name":"ft_balance_of","args_base64":"'"$(printf '{"account_id":"%s"}' "$PROBE" | base64)"'"}}' | jq -r '.result.result|implode')"
for m in ft_burn burn ft_metadata ft_total_supply; do has_method "$TOKEN" "$m" && echo "token_method_$m=present" || echo "token_method_$m=absent"; done
