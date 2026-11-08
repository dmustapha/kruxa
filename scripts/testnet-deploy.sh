#!/usr/bin/env bash
# Prints the testnet deployment commands. Executes them only with --yes AND NEAR_ENV=testnet. Mainnet is refused outright:
# a mainnet deployment is a REQUIRES-DAMI-PER-ACTION-CONFIRMATION step and is never scripted.
# Keys live wherever near-cli-rs keeps them for the HOME you run it with; point HOME at ~/.kruxa-secrets/<dir>/home (mode 700), never at the repo.
#   NEAR_BIN         path of near-cli-rs (default: near)
#   KRUXA_TESTNET_ROOT / KRUXA_OWNER   the funded testnet account that owns the stack (the subaccounts are created under ROOT)
#   KRUXA_PROFILE    core profile (default demo)
#   FUND_*           NEAR to lend each new account; storage is 1e-5 NEAR per byte, so core needs about 1e-5 x wasm bytes + margin
set -euo pipefail
cd "$(dirname "$0")/.."
NEAR="${NEAR_BIN:-near}"
ROOT="${KRUXA_TESTNET_ROOT:?set KRUXA_TESTNET_ROOT, e.g. kruxa.testnet}"
OWNER="${KRUXA_OWNER:?set KRUXA_OWNER (testnet account that signs)}"
PROFILE="${KRUXA_PROFILE:-demo}"
if [ "${NEAR_ENV:-}" = "mainnet" ] || [[ "$ROOT" != *.testnet ]]; then echo "refusing: testnet only"; exit 1; fi
CORE="core.$ROOT"; USDC="usdc.$ROOT"; INTENTS="intents.$ROOT"; FACTORY="factory.$ROOT"
GUARDIAN="guardian.$ROOT"; TREASURY="treasury.$ROOT"; RELAY="relay-fees.$ROOT"
INIT="{\"owner\":\"$OWNER\",\"guardian\":\"$GUARDIAN\",\"treasury\":\"$TREASURY\",\"relay_fees\":\"$RELAY\",\"usdc\":\"$USDC\",\"intents\":\"$INTENTS\",\"factory\":\"$FACTORY\",\"profile\":\"$PROFILE\"}"
USDC_INIT="{\"owner_id\":\"$OWNER\",\"total_supply\":\"0\"}"
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
create() { echo "$NEAR account create-account fund-myself $1 '$2 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER $NET $SIGN"; }
deploy() { echo "$NEAR contract deploy $1 use-file $2 with-init-call new json-args '$3' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET $SIGN"; }
CMDS=(
  "$(create "$CORE" "${FUND_CORE:-8}")"
  "$(create "$USDC" "${FUND_USDC:-2.2}")"
  "$(create "$INTENTS" "${FUND_INTENTS:-2.4}")"
  "$(create "$FACTORY" "${FUND_FACTORY:-1.6}")"
  "$(create "$GUARDIAN" 0.2)"
  "$(create "$TREASURY" 0.2)"
  "$(create "$RELAY" 0.2)"
  "$(deploy "$CORE" target/near/kruxa_core/kruxa_core.wasm "$INIT")"
  "$(deploy "$USDC" target/near/mock_ft/mock_ft.wasm "$USDC_INIT")"
  "$(deploy "$INTENTS" target/near/mock_intents/mock_intents.wasm '{}')"
  "$(deploy "$FACTORY" target/near/mock_factory/mock_factory.wasm '{}')"
)
for c in "${CMDS[@]}"; do
  echo "$c"
  # KRUXA_SKIP_CREATE=1 re-runs only the deploys after an interrupted run (the accounts and their keys already exist)
  if [ "${KRUXA_SKIP_CREATE:-}" = 1 ] && [[ "$c" == *" create-account "* ]]; then continue; fi
  if [ "${1:-}" = "--yes" ] && [ "${NEAR_ENV:-}" = "testnet" ]; then bash -c "$c" > /dev/null; fi
done
[ "${1:-}" = "--yes" ] || echo "(dry run: pass --yes with NEAR_ENV=testnet to execute)"
