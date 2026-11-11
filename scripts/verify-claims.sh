#!/usr/bin/env bash
# Re-derives each seeded claim by running its command. Never reads a stored result.
#   ./scripts/verify-claims.sh                        all claims; any SKIP or FAIL exits 1
#   ./scripts/verify-claims.sh --offline              C-04, C-05, C-06 print SKIP (needs a testnet core / sandbox) and do not fail
#   ./scripts/verify-claims.sh C-04 C-05 --rpc URL --contract ACCOUNT [--profile demo|ladder]
#        the named claims only; C-04 and C-05 read the live core with read-only views (testnet). --profile defaults to demo (the testnet cores).
#   C-04  get_rule_set of the core == Rules in the code (kruxa-sim rules) AND == the caps in app/lib/charter/rules.ts (verify_app_caps.py)
#   C-05  view_code sha256 of the core == artifacts/SHA256SUMS kruxa_core.wasm (verify_near_ops.py CODE line)
#   C-06  needs the sandbox suite: SKIP here, recorded in docs/ATTACK-GALLERY.md
#   C-07  the source paragraph shipped in docs/research/launchpad-claim-source.md cites the preprint and the vendor caveat
set -uo pipefail
cd "$(dirname "$0")/.."
SIM="cargo run -q -p kruxa-sim --"
offline=0; rpc=""; contract=""; profile="demo"; ids=()
while [ "$#" -gt 0 ]; do case "$1" in
  --offline) offline=1 ;;
  --rpc) rpc="${2:-}"; shift ;;
  --contract) contract="${2:-}"; shift ;;
  --profile) profile="${2:-}"; shift ;;
  C-[0-9][0-9]) ids+=("$1") ;;
  *) echo "usage: $0 [--offline] [C-NN ...] [--rpc URL --contract ACCOUNT] [--profile demo|ladder]" >&2; exit 64 ;;
esac; shift; done
fail=0
want() { [ "${#ids[@]}" -eq 0 ] || [[ " ${ids[*]} " == *" $1 "* ]]; }
check() { # id, expected substring, command output
  if printf '%s' "$3" | grep -qF -- "$2"; then echo "$1 PASS"; else echo "$1 FAIL (expected '$2')"; fail=1; fi
}
skip() { echo "$1 SKIP ($2)"; [ "$offline" -eq 1 ] || fail=1; }
live() { [ -n "$rpc" ] && [ -n "$contract" ]; }

want C-01 && check C-01 "outcome=PASS" "$($SIM verdict --launch-id 1 --total-active 350000000 --funders 10 --soft-cap 350000000 --min-funders 10)"
want C-02 && check C-02 "outcome=FAIL(reasons=1)" "$($SIM verdict --launch-id 1 --total-active 349999999 --funders 10 --soft-cap 350000000 --min-funders 10)"
want C-03 && check C-03 "spend=40000000 refund=60000000" "$($SIM settle --total-active 12500000000 --hard-cap 5000000000 --commit 100000000)"
if want C-04; then
  if live; then
    check C-04 "RULES MATCH" "$($SIM rules --profile "$profile" --rpc "$rpc" --contract "$contract" 2>&1)"
    check C-04 "APP CAPS MATCH" "$(python3 -I scripts/verify_app_caps.py --rpc "$rpc" --contract "$contract" 2>&1)"
  else skip C-04 "needs --rpc and --contract of a testnet core"; fi
fi
if want C-05; then
  if live; then check C-05 "; MATCH" "$(python3 -I scripts/verify_near_ops.py --rpc "$rpc" --contract "$contract" --sums artifacts/SHA256SUMS 2>&1)"
  else skip C-05 "needs --rpc and --contract of a testnet core"; fi
fi
want C-06 && skip C-06 "needs the sandbox suite"
if want C-07; then
  check C-07 "arXiv 2602.14860" "$(grep -n '0.63' docs/research/launchpad-claim-source.md 2>&1)"
  check C-07 "a vendor report, self-reported" "$(grep -n 'Solidus' docs/research/launchpad-claim-source.md 2>&1)"
fi
exit "$fail"
