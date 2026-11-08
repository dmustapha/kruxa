#!/usr/bin/env bash
# Re-derives each seeded claim by running its command. Never reads a stored result.
#   ./scripts/verify-claims.sh            all claims; any SKIP or FAIL exits 1
#   ./scripts/verify-claims.sh --offline  C-04 to C-07 print SKIP (needs testnet deploy / source file) and do not fail
set -uo pipefail
cd "$(dirname "$0")/.."
offline=0; [ "${1:-}" = "--offline" ] && offline=1
SIM="cargo run -q -p kruxa-sim --"
fail=0
check() { # id, expected substring, command output
  if printf '%s' "$3" | grep -qF -- "$2"; then echo "$1 PASS"; else echo "$1 FAIL (expected '$2')"; fail=1; fi
}
check C-01 "outcome=PASS" "$($SIM verdict --launch-id 1 --total-active 350000000 --funders 10 --soft-cap 350000000 --min-funders 10)"
check C-02 "outcome=FAIL(reasons=1)" "$($SIM verdict --launch-id 1 --total-active 349999999 --funders 10 --soft-cap 350000000 --min-funders 10)"
check C-03 "spend=40000000 refund=60000000" "$($SIM settle --total-active 12500000000 --hard-cap 5000000000 --commit 100000000)"
for id in C-04 C-05 C-06 C-07; do
  echo "$id SKIP (needs testnet deploy / source file)"
  [ "$offline" -eq 1 ] || fail=1
done
exit "$fail"
