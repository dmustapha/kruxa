#!/usr/bin/env bash
# Gate G3 (Nov 10 EOD): one line per Genesis Round row GR-1 to GR-18 (PRD 9.3) with HARD or WAIVABLE, then GO or NO-GO.
#   ./scripts/gate-g3.sh            read-only: nothing is built, deployed, signed or sent
# Row states: PASS (checked here or recorded), FAIL, UNKNOWN (cannot be tested here and nobody recorded it: never PASS by default),
# PENDING (waits for Dami), WAIVED (WAIVABLE rows only, recorded by Dami with a reason).
# Rows this script checks itself read the logs of the last ./scripts/gate-g1.sh run (target/gate-g1/*.log), the repo and the clock.
# Everything else is read from rehearsal/GATE-EVIDENCE.md, one line per row:
#   | GR-2 | PASS | 2026-11-10T09:00Z | scripts/gate-g2.sh output, evidence/g2.txt |      (state is PASS, FAIL or WAIVED)
# GO needs every HARD row PASS and every WAIVABLE row PASS or WAIVED. Exit 0 on GO, 1 on NO-GO.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=target/gate-g1
EVID=rehearsal/GATE-EVIDENCE.md
BLOCKERS=""

ran_ok() { grep -qE "^test (.*::)?$1 \.\.\. ok$" "$LOG/native.log" "$LOG/sandbox.log" 2>/dev/null; }
have_logs() { [ -s "$LOG/sandbox.log" ] && [ -s "$LOG/native.log" ]; }
suite_failed() { grep -qE "^test result: FAILED|^test .* \.\.\. FAILED$" "$LOG/native.log" "$LOG/sandbox.log" 2>/dev/null; }
recorded() { # state, detail of a row from the evidence file
  [ -f "$EVID" ] || return 1
  grep -E "^\| *$1 *\|" "$EVID" | tail -n 1 | awk -F'|' '{gsub(/ /,"",$3); print $3 "|" $5}' | grep -E '^(PASS|FAIL|WAIVED)\|'
}
emit() { # id kind state detail
  printf '%-6s %-9s %-8s %s\n' "$1" "$2" "$3" "$4"
  case "$3" in PASS) ;; WAIVED) [ "$2" = WAIVABLE ] || BLOCKERS="$BLOCKERS $1" ;; *) BLOCKERS="$BLOCKERS $1" ;; esac
}
tests_row() { # id kind label test...
  local id=$1 kind=$2 label=$3 t; shift 3
  have_logs || { emit "$id" "$kind" UNKNOWN "no $LOG logs: run ./scripts/gate-g1.sh first ($label)"; return; }
  for t in "$@"; do ran_ok "$t" || { emit "$id" "$kind" FAIL "test not ok in the last run: $t"; return; }; done
  emit "$id" "$kind" PASS "$label: $# tests ok in the last run"
}
evidence_row() { # id kind label
  local r; r=$(recorded "$1") || { emit "$1" "$2" UNKNOWN "$3: no line in $EVID"; return; }
  emit "$1" "$2" "${r%%|*}" "$3: ${r#*|}"
}

# GR-1
if have_logs; then
  if suite_failed; then emit GR-1 HARD FAIL "a test failed in the last run"
  elif ran_ok mainnet_profile_refuses_non_owner_create_trial_with_creator_gate && ran_ok open_market_moves_lp_seed_and_recredits_on_failure; then
    emit GR-1 HARD PASS "Wave 1 + D-1 + D-3 suites ok in the last gate-g1 run ($(grep -cE '^test .* \.\.\. ok$' "$LOG/sandbox.log") sandbox tests ok)"
  else emit GR-1 HARD FAIL "D-1 or D-3 tests missing from the last run"; fi
else emit GR-1 HARD UNKNOWN "no $LOG logs: run ./scripts/gate-g1.sh first"; fi
evidence_row GR-2 HARD "devnet end to end, verify exit 0, tamper-all exit 2"
evidence_row GR-3 WAIVABLE "Intents path decided (Test 1 or Solana-landing claims dropped)"
# GR-4
if grep -q '^spent_near=\|spent_near=' evidence/factory-probe.txt 2>/dev/null && grep -q 'token_method_ft_burn=' evidence/factory-probe.txt 2>/dev/null && grep -q 'B-FACTORY' docs/benchmarks.md 2>/dev/null; then
  emit GR-4 HARD PASS "evidence/factory-probe.txt: cost and ft_burn recorded; docs/benchmarks.md B-FACTORY"
else emit GR-4 HARD UNKNOWN "evidence/factory-probe.txt or docs/benchmarks.md B-FACTORY missing"; fi
tests_row GR-5 HARD "caps in code" global_cap_refuses_at_the_real_three_thousand_dollars caps_are_the_ruled_values_and_raising_is_timelocked caps_global_launch_and_holder_limits_hold
tests_row GR-6 HARD "pause, freeze, guardian; exits open while PAUSED" pause_blocks_new_risk_but_not_exits_and_freeze_blocks_exits a_pause_cannot_hold_the_verdict_hostage_but_it_does_hold_creator_payouts
evidence_row GR-7 HARD "Squads vault rehearsed on devnet, 48 h lock, 3 hardware wallets"
evidence_row GR-8 HARD "disclosure pages published"
evidence_row GR-9 HARD "legal minimum"
# GR-10
now=$(date -u +%s); limit=$(date -u -j -f '%Y-%m-%d %H:%M' '2026-11-11 18:00' +%s 2>/dev/null || date -u -d '2026-11-11 18:00' +%s)
if [ "$now" -le "$limit" ]; then emit GR-10 HARD PASS "now $(date -u +%FT%TZ) is $(( (limit - now) / 3600 )) h before the Nov 11 18:00 UTC open-by limit"
else emit GR-10 HARD FAIL "now $(date -u +%FT%TZ) is after the Nov 11 18:00 UTC open-by limit"; fi
# GR-11
if [ -s rehearsal/CONFIRMATIONS.md ]; then emit GR-11 HARD PENDING "rehearsal/CONFIRMATIONS.md exists but Dami's per-step confirmations are read by hand at execution"
else emit GR-11 HARD PENDING "filled at execution, not now"; fi
evidence_row GR-12 HARD "genesis mode decided (F0 3 of 3 or F1 disclosed)"
evidence_row GR-13 WAIVABLE "Meteora spike result recorded"
# GR-14: hash the file the newest FREEZE row names (gate-freeze.sh records its path), not the local dev build. A reproducible candidate
# is a different byte string from target/near/..., so comparing against $WASM could never match. Fall back to artifacts/SHA256SUMS when the
# named file is not in this checkout.
frozen_row=$(grep -E '\| A-4 \|.*FREEZE sha256 [0-9a-f]{64}' rehearsal/LOG.md 2>/dev/null | tail -n 1)
frozen=$(echo "$frozen_row" | grep -oE 'FREEZE sha256 [0-9a-f]{64}' | grep -oE '[0-9a-f]{64}')
frozen_path=$(echo "$frozen_row" | grep -oE 'sha256sum [^` ]+' | head -n 1 | cut -d' ' -f2)
built=""; built_from=""
if [ -n "$frozen_path" ] && [ -f "$frozen_path" ]; then built=$(shasum -a 256 "$frozen_path" | cut -c1-64); built_from="$frozen_path"
elif [ -f artifacts/SHA256SUMS ]; then built=$(awk '$2 ~ /(^|\/)kruxa_core\.wasm$/ {print $1}' artifacts/SHA256SUMS | head -n 1); built_from="artifacts/SHA256SUMS"; fi
if [ -z "$frozen" ]; then emit GR-14 HARD UNKNOWN "no A-4 FREEZE row with a sha256 in rehearsal/LOG.md"
elif [ -z "$built" ]; then emit GR-14 HARD UNKNOWN "the FREEZE row names ${frozen_path:-no file}; neither it nor artifacts/SHA256SUMS is in this checkout (run ./scripts/build-artifacts.sh)"
elif [ "$frozen" != "$built" ]; then emit GR-14 HARD FAIL "wasm $built (from $built_from) differs from the frozen $frozen"
elif have_logs && ran_ok mainnet_profile_refuses_non_owner_create_trial_with_creator_gate && ran_ok after_open_beta_a_non_owner_create_trial_passes; then
  emit GR-14 HARD PASS "wasm sha256 ${frozen:0:16}... equals $built_from; R_CREATOR_GATE tests ok"
else emit GR-14 HARD UNKNOWN "hash matches but no gate-g1 logs with the R_CREATOR_GATE tests"; fi
tests_row GR-15 HARD "open_market handoff against the stub and the real market" open_market_moves_lp_seed_and_recredits_on_failure open_market_against_the_real_market_opens_the_pool_and_a_buy_works
evidence_row GR-16 WAIVABLE "Market-lite testnet e2e (make market-demo); otherwise the market stays testnet"
evidence_row GR-17 HARD "brand-token supply and allocation, USDC payout address, pool and LP-seed amounts ruled"
tests_row GR-18 WAIVABLE "payout_recipient alias in get_charter and get_state" views_show_payout_recipient_equal_to_the_recipient_set_at_create_trial

echo
if [ -z "$BLOCKERS" ]; then echo "GO"; exit 0; fi
echo "NO-GO (blocked by:$BLOCKERS)"
exit 1
