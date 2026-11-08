#!/usr/bin/env bash
# W1-DC-8: fetches the REAL intents.near wasm from a mainnet RPC (read-only view_code) into fixtures/intents_near.wasm and checks the pinned code hash.
set -euo pipefail
cd "$(dirname "$0")/.."
PINNED=BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk
RPC="${MAINNET_RPC:-https://rpc.mainnet.near.org}"
curl -s -m 120 "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_code","finality":"final","account_id":"intents.near"}}' \
  | jq -r .result.code_base64 | base64 -d > fixtures/intents_near.wasm
GOT=$(python3 - <<'PY'
import hashlib
A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n=int.from_bytes(hashlib.sha256(open('fixtures/intents_near.wasm','rb').read()).digest(),'big'); s=''
while n: n,r=divmod(n,58); s=A[r]+s
print(s)
PY
)
[ "$GOT" = "$PINNED" ] && echo "intents.near wasm ok ($(wc -c < fixtures/intents_near.wasm | tr -d ' ') bytes, code hash $GOT)" || { echo "code hash $GOT differs from pinned $PINNED"; exit 1; }
