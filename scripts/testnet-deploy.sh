#!/usr/bin/env bash
# Prints the testnet deployment commands. Executes them only with --yes AND NEAR_ENV=testnet. Mainnet is refused outright:
# a mainnet deployment is a REQUIRES-DAMI-PER-ACTION-CONFIRMATION step and is never scripted.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${KRUXA_TESTNET_ROOT:?set KRUXA_TESTNET_ROOT, e.g. kruxa.testnet}"
OWNER="${KRUXA_OWNER:?set KRUXA_OWNER (testnet account that signs)}"
if [ "${NEAR_ENV:-}" = "mainnet" ] || [[ "$ROOT" != *.testnet ]]; then echo "refusing: testnet only"; exit 1; fi
CORE="core.$ROOT"; USDC="usdc.$ROOT"; INTENTS="intents.$ROOT"; FACTORY="factory.$ROOT"
INIT="{\"owner\":\"$OWNER\",\"guardian\":\"guardian.$ROOT\",\"treasury\":\"treasury.$ROOT\",\"relay_fees\":\"relay-fees.$ROOT\",\"usdc\":\"$USDC\",\"intents\":\"$INTENTS\",\"factory\":\"$FACTORY\",\"profile\":\"demo\"}"
CMDS=(
  "near account create-account fund-myself $CORE '40 NEAR' autogenerate-new-keypair save-to-keychain sign-as $OWNER network-config testnet sign-with-keychain send"
  "near contract deploy $CORE use-file target/near/kruxa_core/kruxa_core.wasm with-init-call new json-args '$INIT' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
  "near contract deploy $USDC use-file target/near/mock_ft/mock_ft.wasm with-init-call new json-args '{\"owner_id\":\"$OWNER\",\"total_supply\":\"0\"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
  "near contract deploy $INTENTS use-file target/near/mock_intents/mock_intents.wasm with-init-call new json-args '{}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
  "near contract deploy $FACTORY use-file target/near/mock_factory/mock_factory.wasm with-init-call new json-args '{}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
)
for c in "${CMDS[@]}"; do
  echo "$c"
  if [ "${1:-}" = "--yes" ] && [ "${NEAR_ENV:-}" = "testnet" ]; then bash -c "$c"; fi
done
[ "${1:-}" = "--yes" ] || echo "(dry run: pass --yes with NEAR_ENV=testnet to execute)"
