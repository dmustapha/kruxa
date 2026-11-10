#!/usr/bin/env bash
# make swarm-testnet (SW-2): replay one recorded swarm run (swarm/runs/run-<seed>.json) as REAL calls on NEAR testnet.
# 16 sub-accounts act as the 16 scripted agents; the core contract is the real one; the invariants are read back from its views.
# TESTNET ONLY. Mainnet is refused. NOT RUN by the build agents: it is written to be run later by the ops agent. Untested on a live network.
#
#   ./scripts/swarm-testnet.sh [--seed N] [--round-secs S]          PLAN ONLY (default): prints every command, sends nothing, needs no keys
#   ./scripts/swarm-testnet.sh [--seed N] [--round-secs S] --yes    execute (also needs NEAR_ENV=testnet)
#
# Environment (same names as scripts/testnet-deploy.sh):
#   KRUXA_TESTNET_ROOT   testnet account the stack lives under (core.<root>, usdc.<root>); must end .testnet
#   KRUXA_OWNER          funded testnet account that signs setup (creates the trial, funds and mints for the sub-accounts)
#   NEAR_BIN             near-cli-rs binary (default: near); keys come from the HOME near-cli-rs uses, never from this repo
#   SWARM_NEAR_FUND      NEAR lent to each sub-account (default 0.6)
#   SWARM_SYMBOL         token symbol of the trial (default SW<seed><HHMMSS>)
# The 16 sub-accounts are sw-<agent id lowercased>.<root> (sw-h1 ... sw-f). Rounds are compressed: one simulated round = --round-secs
# seconds (default 10, so commit = 200 s and tail = 40 s, above the demo profile minimums of 90 s and 30 s).
#
# Output ends with "SWARM-TESTNET GREEN" (exit 0) when the on-chain totals and verdict equal the recorded run, "SWARM-TESTNET RED" (exit 1)
# otherwise, and always prints the transaction count. A slow RPC can push a commit past commit_end; that shows up as RED, not as a pass.
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=1; ROUND_SECS=10; YES=0
while [ "$#" -gt 0 ]; do case "$1" in
  --seed) SEED="${2:?--seed needs a number}"; shift ;;
  --round-secs) ROUND_SECS="${2:?--round-secs needs a number}"; shift ;;
  --yes) YES=1 ;;
  -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "usage: $0 [--seed N] [--round-secs S] [--yes]" >&2; exit 64 ;;
esac; shift; done

RUN="swarm/runs/run-$SEED.json"
[ -f "$RUN" ] || { echo "no recorded run $RUN (seeds 1 to 3 are committed)" >&2; exit 64; }
for c in python3 jq curl; do command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }; done

NEAR="${NEAR_BIN:-near}"
ROOT="${KRUXA_TESTNET_ROOT:-kruxa.testnet}"
OWNER="${KRUXA_OWNER:-owner.$ROOT}"
[[ "$ROOT" == *.testnet && "${NEAR_ENV:-testnet}" != mainnet ]] || { echo "refusing: testnet only" >&2; exit 1; }
if [ "$YES" = 1 ] && [ "${NEAR_ENV:-}" != testnet ]; then echo "refusing to send: set NEAR_ENV=testnet" >&2; exit 1; fi
CORE="core.$ROOT"; USDC="usdc.$ROOT"; RPC="${SWARM_RPC:-https://rpc.testnet.near.org}"
SYMBOL="${SWARM_SYMBOL:-SW${SEED}$(date +%H%M%S | tr 0-9 A-J)}"
FUND="${SWARM_NEAR_FUND:-0.6}"
NET="network-config testnet"; SIGN="sign-with-legacy-keychain send"
TX=0

# ---- plan: everything derived from the recorded run, as TSV ------------------------------------------------------------------
plan() {
  python3 -I - "$RUN" "$ROOT" "$ROUND_SECS" "$SYMBOL" <<'PY'
import json, sys
run = json.load(open(sys.argv[1])); root, rs, symbol = sys.argv[2], int(sys.argv[3]), sys.argv[4]
t = run["trial"]; agents = run["agents"]
acct = lambda a: f"sw-{a['id'].lower()}.{root}"
params = {
    "symbol": symbol, "name": f"{symbol} Swarm Test", "total_supply_whole": 1_000_000_000,
    "sale_bps": 6000, "lp_bps": 2500, "creator_bps": 1000, "backer_bps": 500,
    "hard_cap": t["hard_cap"], "soft_cap": t["soft_cap"], "min_buy": t["min_buy"],
    "wallet_bps": int(t["wallet_cap"]) * 10000 // int(t["hard_cap"]), "min_funders": t["min_funders"],
    "open_delay_secs": 30, "commit_secs": t["commit_end_round"] * rs,
    "tail_secs": (t["walk_end_round"] - t["commit_end_round"]) * rs, "stream_days": 30,
}
print("PARAMS", json.dumps(params, separators=(",", ":")), sep="\t")
for a in agents:
    print("ACCOUNT", acct(a), a["budget"], sep="\t")
for r in run["rounds"]:
    for e in r["events"]:
        print("EVENT", r["round"], acct(agents[e["agent"]]), e["action"], e["amount"], e["result"], sep="\t")
last, s = run["rounds"][-1], run["settlement"]
print("EXPECT", last["total_committed"], last["funders"], s["verdict"], sep="\t")
PY
}

# ---- one transaction: print it, send it only with --yes ----------------------------------------------------------------------
send() { # <description> <signer> <receiver> <method> <json args> <gas> <deposit>
  local desc=$1 signer=$2 receiver=$3 method=$4 args=$5 gas=$6 dep=$7
  local cmd="$NEAR contract call-function as-transaction $receiver $method json-args '$args' prepaid-gas '$gas' attached-deposit '$dep' sign-as $signer $NET $SIGN"
  echo "  [$desc] $cmd"
  [ "$YES" = 1 ] || return 0
  bash -c "$cmd" </dev/null >/dev/null 2>&1 && TX=$((TX + 1)) || echo "  (call failed: $desc)" >&2
}
view() { # <account> <method> <json args>  -> prints the JSON result (empty when not --yes)
  [ "$YES" = 1 ] || { echo "{}"; return 0; }
  curl -s -m 30 "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"'"$1"'","method_name":"'"$2"'","args_base64":"'"$(printf '%s' "$3" | base64 | tr -d '\n')"'"}}' \
    | jq -r '.result.result // empty | implode' 2>/dev/null || echo "{}"
}

setup_accounts() { # reads ACCOUNT lines
  local kind id budget
  while IFS=$'\t' read -r kind id budget; do
    [ "$kind" = ACCOUNT ] || continue
    echo "  [create $id] $NEAR account create-account fund-myself $id '$FUND NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER $NET $SIGN"
    [ "$YES" = 1 ] && { bash -c "$NEAR account create-account fund-myself $id '$FUND NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER $NET $SIGN" </dev/null >/dev/null 2>&1 && TX=$((TX + 1)) || echo "  (create failed: $id)" >&2; }
    send "mint $budget micro-USDC to $id" "$OWNER" "$USDC" mint "{\"account_id\":\"$id\",\"amount\":\"$budget\"}" '30 Tgas' '0 NEAR'
  done
}

create_trial() { # <params json> -> launch id on stdout
  local dep; dep=$(view "$CORE" required_deposit "{\"params\":$1}" | tr -d '"')
  [ "$YES" = 1 ] || dep=5000000000000000000000000   # plan-only placeholder (5 NEAR); a real run reads required_deposit
  send "create_trial $SYMBOL" "$OWNER" "$CORE" create_trial "{\"params\":$1,\"stream_recipient\":null,\"genesis\":null}" '300 Tgas' "$(python3 -I -c 'import sys;print(f"{int(sys.argv[1])/1e24:.6f} NEAR")' "$dep")" >&2
  if [ "$YES" = 1 ]; then sleep 15; view "$CORE" get_config '{}' | jq -r '.next_launch_id - 1'; else echo 0; fi
}

replay_events() { # <launch id> ; reads EVENT lines, paces them on the round clock
  local lid=$1 t0=$CREATED_AT kind round who action amount expect due
  local open_wait=33   # the clock starts when create_trial was sent; open_delay_secs is 30, so round 0 starts 3 s after the pool opens
  sleep_until() { [ "$YES" = 1 ] && { local now=$((SECONDS - t0)); [ "$1" -gt "$now" ] && sleep $(($1 - now)); }; return 0; }
  while IFS=$'\t' read -r kind round who action amount expect; do
    [ "$kind" = EVENT ] || continue
    due=$((open_wait + round * ROUND_SECS)); sleep_until "$due"
    if [ "$action" = commit ]; then
      send "round $round commit $amount (recorded: $expect)" "$who" "$USDC" ft_transfer_call \
        "{\"receiver_id\":\"$CORE\",\"amount\":\"$amount\",\"msg\":\"{\\\"v\\\":1,\\\"op\\\":\\\"contribute\\\",\\\"launch_id\\\":\\\"$lid\\\"}\"}" '100 Tgas' '1 yoctoNEAR'
    else
      send "round $round walk (recorded: $expect)" "$who" "$CORE" walk "{\"launch_id\":\"$lid\"}" '100 Tgas' '1 yoctoNEAR'
    fi
  done
}

verdict_check() { # <launch id> <expected total> <expected funders> <expected verdict> ; settles, then compares
  local lid=$1 want_total=$2 want_funders=$3 want_verdict=$4 st got_total got_funders status ok=1
  [ "$YES" = 1 ] && sleep $((ROUND_SECS + 5))
  st=$(view "$CORE" get_state "{\"launch_id\":\"$lid\"}"); got_total=$(echo "$st" | jq -r '.total_active // "n/a"'); got_funders=$(echo "$st" | jq -r '.active_funders // "n/a"')
  echo "  before settle: total_active $got_total (recorded $want_total), active_funders $got_funders (recorded $want_funders)"
  [ "$YES" = 1 ] && { [ "$got_total" = "$want_total" ] && [ "$got_funders" = "$want_funders" ] || ok=0; }
  send "settle" "$OWNER" "$CORE" settle "{\"launch_id\":\"$lid\"}" '300 Tgas' '0 NEAR'
  [ "$YES" = 1 ] && sleep 10
  status=$(view "$CORE" get_state "{\"launch_id\":\"$lid\"}" | jq -r '.status // "n/a"')
  echo "  after settle: status $status (recorded verdict $want_verdict)"
  if [ "$YES" = 1 ]; then
    case "$want_verdict:$status" in PASS:Passed|FAIL*:Failed*) ;; *) ok=0 ;; esac
    inv=$(view "$CORE" get_invariants "{\"launch_id\":\"$lid\"}"); echo "  get_invariants: $(echo "$inv" | jq -c . 2>/dev/null || echo "$inv")"
  fi
  [ "$ok" = 1 ]
}

# ---- main --------------------------------------------------------------------------------------------------------------------
PLAN=$(plan)
PARAMS=$(echo "$PLAN" | awk -F'\t' '$1=="PARAMS" {print $2}')
read -r WANT_TOTAL WANT_FUNDERS WANT_VERDICT < <(echo "$PLAN" | awk -F'\t' '$1=="EXPECT" {print $2, $3, $4}')
echo "swarm-testnet: seed $SEED, $(echo "$PLAN" | grep -c '^EVENT') recorded events, $(echo "$PLAN" | grep -c '^ACCOUNT') sub-accounts, round $ROUND_SECS s, core $CORE$([ "$YES" = 1 ] || echo '  (PLAN ONLY, nothing is sent; pass --yes with NEAR_ENV=testnet to execute)')"
echo "== setup"; echo "$PLAN" | setup_accounts
echo "== create"; CREATED_AT=$SECONDS; LID=$(create_trial "$PARAMS")
echo "== replay (launch $LID)"; echo "$PLAN" | replay_events "$LID"
echo "== read back"
if verdict_check "$LID" "$WANT_TOTAL" "$WANT_FUNDERS" "$WANT_VERDICT"; then RES=GREEN; RC=0; else RES=RED; RC=1; fi
echo "transactions sent: $TX"
if [ "$YES" = 1 ]; then echo "SWARM-TESTNET $RES"; else echo "SWARM-TESTNET PLANNED (no transactions; not a pass)"; RC=0; fi
exit $RC
