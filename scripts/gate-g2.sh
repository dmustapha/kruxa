#!/usr/bin/env bash
# Gate G2 (PLAN Task 5.1): the nine devnet/testnet end-to-end checks, one PASS or FAIL line each, then G2 GREEN or G2 RED.
#   ./scripts/gate-g2.sh                  all nine; G2-01 runs ./scripts/gate-g1.sh (7 to 10 minutes), G2-02..06 read live RPCs
#   ./scripts/gate-g2.sh --g1-from-logs   G2-01 reads the logs of the last gate-g1 run (target/gate-g1/) instead of running it
#   ./scripts/gate-g2.sh --offline        the rows that need a network print SKIP; the gate can then never be GREEN
# Env (defaults in brackets): KRUXA_NEAR_RPC [https://test.rpc.fastnear.com], KRUXA_CONTRACT [core.kruxa.testnet],
#   G2_PASS_ID [1], G2_FAIL_ID [2] (the testnet PASS and FAIL launches), G2_F0_RECORD [evidence/f0-rehearsal.json, else the newest evidence/genesis-*.json].
# gate-g3.sh GR-2 reads this script's output pasted into rehearsal/GATE-EVIDENCE.md; GR-12 and G2-07 read the genesis mode (below).
# Nothing here signs, deploys or sends a transaction; verify.sh and the scans are read-only. Every process it starts is gone when it exits.
set -uo pipefail
cd "$(dirname "$0")/.."
G1_MODE=run; OFFLINE=0
for a in "$@"; do case "$a" in
  --g1-from-logs) G1_MODE=logs ;;
  --offline) OFFLINE=1 ;;
  *) echo "usage: gate-g2.sh [--g1-from-logs] [--offline]" >&2; exit 64 ;;
esac; done
NEAR_RPC="${KRUXA_NEAR_RPC:-https://test.rpc.fastnear.com}"
CONTRACT="${KRUXA_CONTRACT:-core.kruxa.testnet}"
PASS_ID="${G2_PASS_ID:-1}"; FAIL_ID="${G2_FAIL_ID:-2}"
F0_RECORD="${G2_F0_RECORD:-}"
if [ -z "$F0_RECORD" ]; then # the F0 rehearsal record, else the newest published genesis record
  F0_RECORD=evidence/f0-rehearsal.json
  [ -f "$F0_RECORD" ] || F0_RECORD=$(ls evidence/genesis-*.json 2>/dev/null | sort -V | tail -n 1 || true)
fi
FAILS=0; SKIPS=0

row() { # id label ok(0/1) detail
  if [ "$3" -eq 0 ]; then echo "PASS $1 $2"; else echo "FAIL $1 $2 -- $4"; FAILS=$((FAILS + 1)); fi
}
skip() { echo "SKIP $1 $2 -- needs a network (--offline)"; SKIPS=$((SKIPS + 1)); }
last_line() { tr -d '\r' | grep -v '^$' | tail -n 1; }

# G2-01 G1 still green
if [ "$G1_MODE" = run ]; then
  out=$(./scripts/gate-g1.sh 2>&1); code=$?
  row G2-01 "G1 still green" "$code" "$(echo "$out" | last_line)"
else
  if [ -s target/gate-g1/native.log ] && [ -s target/gate-g1/sandbox.log ] && ! grep -qE "^test result: FAILED|^test .* \.\.\. FAILED$" target/gate-g1/native.log target/gate-g1/sandbox.log; then
    row G2-01 "G1 still green (last run's logs: no failed test)" 0 ""
  else row G2-01 "G1 still green" 1 "no target/gate-g1 logs, or a test failed in them: run ./scripts/gate-g1.sh"; fi
fi

# G2-02 and G2-03: the recorded verdicts recompute from public views
net_row() { # id label launch expected-verdict
  if [ "$OFFLINE" -eq 1 ]; then skip "$1" "$2"; return; fi
  local out code
  out=$(./scripts/verify.sh chain "$NEAR_RPC" "$CONTRACT" "$3" 2>&1); code=$?
  if [ "$code" -eq 0 ] && echo "$out" | grep -q "^MATCH" && echo "$out" | grep -qi "$4"; then row "$1" "$2" 0 ""
  else row "$1" "$2" 1 "exit $code: $(echo "$out" | last_line)"; fi
}
net_row G2-02 "testnet PASS launch $PASS_ID: MATCH, PASS" "$PASS_ID" PASS
net_row G2-03 "testnet FAIL launch $FAIL_ID: MATCH, FAIL" "$FAIL_ID" FAIL

# G2-04 .. G2-06: the devnet mint, tamper detection, and the FAIL launch that has no mint
if [ "$OFFLINE" -eq 1 ]; then
  skip G2-04 "devnet mint: verify.sh $PASS_ID exit 0"; skip G2-05 "tamper: verify.sh $PASS_ID --tamper-all exit 2"; skip G2-06 "FAIL launch has no mint"
else
  out=$(./scripts/verify.sh "$PASS_ID" 2>&1); code=$?
  row G2-04 "devnet mint: verify.sh $PASS_ID exit 0" "$code" "exit $code: $(echo "$out" | last_line)"
  out=$(./scripts/verify.sh "$PASS_ID" --tamper-all 2>&1); code=$?
  [ "$code" -eq 2 ] && ok=0 || ok=1
  row G2-05 "tamper: verify.sh $PASS_ID --tamper-all exit 2" "$ok" "exit $code (want 2): $(echo "$out" | last_line)"
  out=$(./scripts/verify.sh "$FAIL_ID" 2>&1); code=$?
  [ "$code" -eq 0 ] && echo "$out" | grep -q "no mint (expected for FAIL)" && ok=0 || ok=1
  row G2-06 "FAIL launch $FAIL_ID has no mint: prints 'no mint (expected for FAIL)', exit 0" "$ok" "exit $code: $(echo "$out" | last_line)"
fi

# G2-07 genesis mode: F0 (3 of 3 is judged by GR-12 from the rehearsal log) or F1 with the fallback change-order recorded
if [ -f "$F0_RECORD" ]; then
  mode=$(jq -r .mode "$F0_RECORD" 2>/dev/null || echo "unreadable")
  if [ "$mode" = F0 ]; then row G2-07 "genesis mode F0 ($F0_RECORD)" 0 ""
  elif [ "$mode" = F1 ] && grep -qE "F1 fallback adopted" docs/CHANGE-ORDERS.md 2>/dev/null; then row G2-07 "genesis mode F1 with the fallback change-order" 0 ""
  else row G2-07 "genesis mode" 1 "$F0_RECORD says mode $mode; F1 needs a docs/CHANGE-ORDERS.md row containing 'F1 fallback adopted'"; fi
else row G2-07 "genesis mode" 1 "no $F0_RECORD (copy the F0 rehearsal record there)"; fi

# G2-08 hygiene: no key material in tracked files; mainnet-beta may appear only in the guarded files (docs/MAINNET-SOLANA-GENESIS.md section 6)
scan=$(./scripts/secret-scan.sh 2>&1); scan_code=$?
allowed='cluster.ts|ceremony.ts|genesis-cli.ts|genesis-mainnet.ts|mainnet-guard.ts|mainnet-programs.ts|watcher-cli.ts|watcher-guard.ts'
mainnet=$(grep -l "mainnet-beta" relayer/src/*.ts | grep -v '\.test\.ts$' | grep -Ev "/($allowed)$" | wc -l | tr -d ' ')
unguarded=$(grep -c "MAINNET_CONFIRM_ENV" relayer/src/cluster.ts || true)
if [ "$scan_code" -eq 0 ] && [ "$mainnet" -eq 0 ] && [ "$unguarded" -ge 1 ]; then row G2-08 "hygiene: secret-scan PASS, mainnet-beta only in the guarded relayer files" 0 ""
else row G2-08 "hygiene" 1 "secret-scan exit $scan_code ($(echo "$scan" | last_line)); mainnet-beta in unguarded files: $mainnet; cluster.ts confirm guard lines: $unguarded"; fi

# G2-09 no mainnet writes: every mention of mainnet in the devnet genesis script is its refusal text
bad=$(grep -in "mainnet" scripts/genesis-devnet.sh | grep -viE "refus|impossible" || true)
if [ -z "$bad" ]; then row G2-09 "no mainnet writes: scripts/genesis-devnet.sh mentions mainnet only to refuse it" 0 ""
else row G2-09 "no mainnet writes" 1 "$(echo "$bad" | head -n 1)"; fi

echo
if [ "$FAILS" -eq 0 ] && [ "$SKIPS" -eq 0 ]; then echo "G2 GREEN (9 of 9)"; exit 0; fi
[ "$SKIPS" -gt 0 ] && echo "G2 NOT GREEN: $SKIPS row(s) skipped (--offline); run without it on a networked machine"
[ "$FAILS" -gt 0 ] && echo "G2 RED ($FAILS failing). Apply DT-G2 (PLAN Task 5.1) and tell Dami."
exit 1
