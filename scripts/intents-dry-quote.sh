#!/usr/bin/env bash
# DeFi track step: one READ-ONLY 1Click dry quote. "dry": true means no deposit address is created and nothing can be sent.
#   ./scripts/intents-dry-quote.sh              ask the live public endpoint; falls back to the RECORDED fixture if the network is down
#   ./scripts/intents-dry-quote.sh --offline    skip the network and replay fixtures/dry-quote.json (labelled RECORDED)
#   ./scripts/intents-dry-quote.sh --refresh    live only; rewrite fixtures/dry-quote.json from the response (exit 1 if not HTTP 201)
# Needs no key: the public dry endpoint answers without a JWT (an unauthenticated quote carries the extra 0.25% app fee on a real swap).
# The script never reads or sends a credential. If the endpoint ever starts to demand a JWT (HTTP 401 or 403), it says so and uses the fixture.
# Prints "HTTP <status>" first, then a LIVE or RECORDED label. Exit 0 when the (live or recorded) status is 201, 1 otherwise, 64 usage.
set -euo pipefail
cd "$(dirname "$0")/.."
API="${KRUXA_1CLICK_URL:-https://1click.chaindefuser.com/v0/quote}"
FIXTURE=fixtures/dry-quote.json
MODE=auto
case "${1:-}" in
  "") ;;
  --offline) MODE=offline ;;
  --refresh) MODE=refresh ;;
  *) echo "usage: $0 [--offline | --refresh]" >&2; exit 64 ;;
esac

# Public values only: a wrapped-NEAR to ETH quote, a well-known public Ethereum address, the public account near (the endpoint rejects an account that does not exist).
request() {
  python3 -I - <<'PY'
import datetime, json
deadline = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
print(json.dumps({
    "dry": True, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
    "originAsset": "nep141:wrap.near", "depositType": "ORIGIN_CHAIN",
    "destinationAsset": "nep141:eth.omft.near", "amount": "1000000000000000000000000",
    "recipient": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "recipientType": "DESTINATION_CHAIN",
    "refundTo": "near", "refundType": "ORIGIN_CHAIN", "deadline": deadline,
}))
PY
}

summary() { # <json file>
  python3 -I - "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
q = d.get("quote", d)
for k in ("amountInFormatted", "amountOutFormatted", "timeEstimate", "minAmountOut"):
    if k in q:
        print(f"  {k}: {q[k]}")
print("  dry quote: no deposit address was issued, nothing can be sent")
PY
}

body=$(mktemp); trap 'rm -f "$body"' EXIT
status=000
if [ "$MODE" != offline ]; then
  status=$(request | curl -sS --max-time 20 -o "$body" -w '%{http_code}' -X POST "$API" \
    -H 'Content-Type: application/json' --data-binary @- 2>/dev/null) || status=000
fi

if [ "$status" = 201 ]; then
  echo "HTTP 201"
  echo "LIVE: read-only dry quote from $API"
  summary "$body"
  if [ "$MODE" = refresh ]; then
    python3 -I - "$body" "$FIXTURE" <<'PY'
import datetime, json, sys
quote = json.load(open(sys.argv[1]))
fixture = {
    "label": "RECORDED",
    "note": "A real 1Click dry quote response (HTTP 201), saved by scripts/intents-dry-quote.sh --refresh. Dry: no deposit address, nothing sendable. Replayed when the network is unavailable.",
    "http_status": 201,
    "recorded_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "endpoint": "POST https://1click.chaindefuser.com/v0/quote",
    "response": quote,
}
json.dump(fixture, open(sys.argv[2], "w"), indent=2)
open(sys.argv[2], "a").write("\n")
PY
    echo "fixture rewritten: $FIXTURE"
  fi
  exit 0
fi

[ "$MODE" = refresh ] && { echo "HTTP $status: refusing to rewrite the fixture from a non-201 answer" >&2; exit 1; }
case "$status" in
  401|403) why="the endpoint answered HTTP $status (it wants a JWT; this script never sends one)" ;;
  000) why="network unavailable or offline mode" ;;
  *) why="live endpoint answered HTTP $status" ;;
esac
[ -f "$FIXTURE" ] || { echo "HTTP $status and no $FIXTURE to replay" >&2; exit 1; }
rec=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["http_status"])' "$FIXTURE")
echo "HTTP $rec"
echo "RECORDED, not live: $why; replaying $FIXTURE"
python3 -I -c 'import json,sys; json.dump(json.load(open(sys.argv[1]))["response"], open(sys.argv[2],"w"))' "$FIXTURE" "$body"
summary "$body"
[ "$rec" = 201 ]
