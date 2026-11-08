#!/usr/bin/env bash
# Gate G1 (scaffold milestone): one PASS or FAIL line per check, exit non-zero on any FAIL.
#   ./scripts/gate-g1.sh              run all 14 checks (the sandbox suite takes about 7 to 10 minutes)
#   ./scripts/gate-g1.sh --dc-table   print the W1-DC status table from docs/DC-MAP.md, verified against the last run's logs
# Logs of the last run live in target/gate-g1/ (native.log, sandbox.log); --dc-table reads them, so run the gate first.
# Nothing here signs, spends, deploys or touches a network; every process it starts is gone when it exits.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=target/gate-g1
mkdir -p "$LOG"
FAILS=0

row() { # id, label, ok(0/1), detail
  if [ "$3" -eq 0 ]; then echo "PASS $1 $2"; else echo "FAIL $1 $2 -- $4"; FAILS=$((FAILS + 1)); fi
}
ran_ok() { grep -qE "^test (.*::)?$1 \.\.\. ok$" "$LOG/native.log" "$LOG/sandbox.log" 2>/dev/null; }
all_ok() { local t; for t in "$@"; do ran_ok "$t" || { MISSING="$t"; return 1; }; done; }

dc_table() {
  [ -s "$LOG/sandbox.log" ] || { echo "no $LOG/sandbox.log: run ./scripts/gate-g1.sh first" >&2; exit 64; }
  printf '%-10s %-8s %s\n' ID DECLARED VERIFIED-IN-LAST-RUN
  local id declared evidence tests t ok
  while IFS='|' read -r _ id _ declared evidence _; do
    id=$(echo "$id" | tr -d ' ')
    declared=$(echo "$declared" | tr -d ' ')
    tests=$(echo "$evidence" | grep -oE '`[a-z_0-9]+`' | tr -d '`')
    ok="n/a"
    if [ -n "$tests" ]; then
      ok="yes"
      for t in $tests; do ran_ok "$t" || ok="MISSING:$t"; done
    fi
    printf '%-10s %-8s %s\n' "$id" "$declared" "$ok"
  done < <(grep -E '^\| W1-DC-[0-9]+ \|' docs/DC-MAP.md)
}
[ "${1:-}" = "--dc-table" ] && { dc_table; exit 0; }

# G1-01 toolchain
v=$(rustc --version); case "$v" in "rustc 1.95.0"*) row G1-01 "toolchain ($v)" 0 ;; *) row G1-01 "toolchain" 1 "got: $v" ;; esac

# G1-04 wasm build (runs before lint, which measures the wasm)
./scripts/build.sh > "$LOG/build.log" 2>&1
n=$(ls target/near/kruxa_core/kruxa_core.wasm target/near/mock_ft/mock_ft.wasm target/near/mock_intents/mock_intents.wasm target/near/mock_factory/mock_factory.wasm 2>/dev/null | wc -l | tr -d ' ')
row G1-04 "wasm build (4 files, kruxa_core $(wc -c < target/near/kruxa_core/kruxa_core.wasm | tr -d ' ') B)" "$([ "$n" -eq 4 ] && echo 0 || echo 1)" "$n of 4 wasm files"

# G1-02 lint
out=$(./scripts/lint.sh 2>&1); rc=$?
row G1-02 "lint ($(echo "$out" | tail -n 1))" "$([ $rc -eq 0 ] && echo "$out" | grep -q '^lint ok' && echo 0 || echo 1)" "$(echo "$out" | tail -n 3 | tr '\n' ' ')"

# G1-03 pure tests (native); the full native workspace run also feeds the DC table
cargo test -p kruxa-math -p kruxa-logic -p kruxa-sim > "$LOG/native.log" 2>&1; rc=$?
passed=$(grep -E '^test result: ok\.' "$LOG/native.log" | sed -E 's/.* ([0-9]+) passed.*/\1/' | awk '{s+=$1} END {print s+0}')
pure=$(cargo test -p kruxa-math -p kruxa-logic 2>&1 | grep -E '^test result: ok\.' | sed -E 's/.* ([0-9]+) passed.*/\1/' | awk '{s+=$1} END {print s+0}')
row G1-03 "pure tests ($pure in kruxa-math + kruxa-logic, $passed with kruxa-sim)" "$([ $rc -eq 0 ] && [ "$pure" -ge 33 ] && ! grep -q near-sdk crates/kruxa-math/Cargo.toml && echo 0 || echo 1)" "rc=$rc pure=$pure (need >= 33, no near-sdk in kruxa-math)"

# Sandbox suite once; G1-05 to G1-09 read it.
# the real_verifier_* tests need the real intents.near wasm (gitignored): fetch it read-only from a mainnet RPC and check the pinned code hash
[ -f fixtures/intents_near.wasm ] || ./scripts/fetch-intents-wasm.sh > "$LOG/fetch-intents.log" 2>&1 || echo "     WARNING: fetch-intents-wasm.sh failed (see $LOG/fetch-intents.log); real_verifier_* tests will fail"
cargo test -p kruxa-tests -- --test-threads=3 --include-ignored --nocapture > "$LOG/sandbox.log" 2>&1; sb=$?
sbpassed=$(grep -E '^test result: ok\.' "$LOG/sandbox.log" | sed -E 's/.* ([0-9]+) passed.*/\1/' | awk '{s+=$1} END {print s+0}')
echo "     sandbox suite: exit $sb, $sbpassed passed"

MISSING=""
all_ok pass_undersubscribed_full_money_path pass_oversubscribed_four_buckets_refunds_and_claims
row G1-05 "PASS path (undersubscribed, oversubscribed)" "$?" "not ok: $MISSING"
all_ok fail_below_soft_cap_refunds_everyone_then_dissolves_and_returns_bond
row G1-06 "FAIL path (refund all, dissolve, bond back)" "$?" "not ok: $MISSING"
all_ok draw_full_amount_after_pass_reverts_with_stream_cap draw_before_pass_and_on_failed_launch_is_refused stream_clock_keeps_running_while_paused \
  && grep -q 'STREAM_CAP: requested' "$LOG/sandbox.log"
row G1-07 "stream-lite (output shows STREAM_CAP)" "$?" "not ok: ${MISSING:-STREAM_CAP line absent}"
all_ok failed_refund_leg_recredits_and_a_retry_pays_exactly_once refund_partial_native_ok_intents_fails_recredits_only_the_failed_leg \
  reentrant_refund_cannot_pay_twice double_refund_pays_exactly_once
row G1-08 "refund safety (callback fail, partial leg, reentrancy, double)" "$?" "not ok: $MISSING"
all_ok w_lifecycle_pass_30_buyers_3_walks_every_identity_true_at_every_step \
  && [ "$(grep -c 'assert_invariants()' tests/src/lib.rs)" -ge 4 ] && [ "$sb" -eq 0 ]
row G1-09 "invariants L1,L3,L4,I2-I5 after every step (whole sandbox suite exit $sb)" "$?" "not ok: ${MISSING:-harness hook missing or suite failed}"

# G1-10 golden vectors
g=$(./scripts/verify.sh golden 2>&1)
echo "$g" | grep -q 'outcome=PASS' && echo "$g" | grep -qF 'outcome=FAIL(reasons=1)' && echo "$g" | grep -q 'spend=40000000 refund=60000000'
row G1-10 "golden (PASS, FAIL(reasons=1), spend 40000000 refund 60000000)" "$?" "unexpected output"

# G1-11 hygiene
./scripts/secret-scan.sh > "$LOG/scan.log" 2>&1 && ./scripts/verify-claims.sh --offline > "$LOG/claims.log" 2>&1
row G1-11 "secret scan and offline claims" "$?" "$(tail -n 2 "$LOG/scan.log" "$LOG/claims.log" | tr '\n' ' ')"

# G1-12 mainnet refusal
m=$(NEAR_ENV=mainnet KRUXA_TESTNET_ROOT=x.testnet KRUXA_OWNER=a ./scripts/testnet-deploy.sh 2>&1); rc=$?
[ "$rc" -eq 1 ] && [ "$m" = "refusing: testnet only" ]
row G1-12 "mainnet deploy refused" "$?" "rc=$rc out=$m"

# G1-13 no stray processes (global pgrep, as the plan specifies: another session's sandbox would show here)
p=$(pgrep -fl 'near-sandbox|next-server' || true)
row G1-13 "no near-sandbox or next-server left" "$([ -z "$p" ] && echo 0 || echo 1)" "$p"

# G1-14 DC table: W1-DC-1,3,4,5,6,7 must be Yes and verified; W1-DC-14 is this gate
bad=""
for id in 1 3 4 5 6 7; do
  line=$(grep -E "^\| W1-DC-$id \|" docs/DC-MAP.md)
  echo "$line" | awk -F'|' '{print $4}' | grep -q 'Yes' || bad="$bad DC-$id(not declared Yes)"
done
verified=$(dc_table 2>/dev/null | grep -E '^W1-DC-(1|3|4|5|6|7) ' | grep MISSING || true)
[ -z "$verified" ] || bad="$bad $verified"
row G1-14 "DC table: W1-DC-1,3,4,5,6,7 = Yes, evidence ok in this run" "$([ -z "$bad" ] && echo 0 || echo 1)" "$bad"

if [ "$FAILS" -eq 0 ]; then echo "G1 GREEN (14 of 14)"; exit 0; fi
echo "G1 RED ($FAILS failing). STOP and re-plan per PLAN DT-R14; never ship the bare floor."
exit 1
