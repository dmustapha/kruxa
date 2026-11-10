#!/usr/bin/env bash
# Seeds the demo launches on the core3 testnet deployment (NEAR TESTNET and Solana DEVNET, play money only). Mainnet is refused.
#   ./scripts/seed-demo.sh A      launch A: PASS, F0 genesis plan, 12 Solana buyers          (create, commit, wait for Ready)
#   ./scripts/seed-demo.sh B      launch B: FAIL (5 funders, under the minimum)
#   ./scripts/seed-demo.sh C      launch C: PASS, F1 plan, 11 Solana + 1 NEAR buyer
#   ./scripts/seed-demo.sh settle <id>     keeper: settle, pages, sweep, consolidate, fees  (scripts/keeper.sh)
#   ./scripts/seed-demo.sh genesis <id> F0|F1   Solana genesis ceremony on devnet (F0 signs through the core's register_f0_message / sign_genesis gate)
#   ./scripts/seed-demo.sh market <id>     open_market, then buy, claim owed, buy, sell on the market (launch must be settled and consolidated)
#   ./scripts/seed-demo.sh all             A, B, C in order, each settled, plus the genesis of A and C and the market flow of C
# Needs ~/.kruxa-secrets/instant-testnet/kxi-root-1108.testnet.json (the funded throwaway root, mode 600), the devnet relayer and Squads keys under
# ~/.kruxa-secrets/genesis, and `npm ci` in scripts/instant-testnet, relayer and tools/squads. Evidence: evidence/testnet-core3/, evidence/genesis/.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${NEAR_ENV:-testnet}" = "mainnet" ] && { echo "refusing: seed-demo is testnet only"; exit 1; }
export KXI_ROOT="${KXI_ROOT:-kxi-root-1108.testnet}"
[[ "$KXI_ROOT" == *.testnet ]] || { echo "refusing: KXI_ROOT must be a .testnet account"; exit 1; }
export NEAR_ENV=testnet KRUXA_CORE="core3.$KXI_ROOT" KRUXA_KEEPER="keeper.$KXI_ROOT" KRUXA_CONTRACT="core3.$KXI_ROOT"
export JITO_PROGRAM="${JITO_PROGRAM:-9XYvBtToi9VafC6AvGL5UKp6Du2htBhAr2XL6UDptfCs}" # patched rehearsal copy of the Jito distributor on devnet
export KRUXA_GENESIS_PREFIX=evidence/genesis/core3/genesis-
SQUADS="${SQUADS_MULTISIG:-CneX72zHFJsd71BBZ39xAuBH8zBySsWo6RedYr6j6A1Z}"
CT=scripts/core-testnet

launch_id() { # the id the seeded launch got, from the evidence book
  node -e 'const b=JSON.parse(require("fs").readFileSync("evidence/testnet-core3/launches.json","utf8"));console.log(b[process.argv[1]].id)' "$1"
}
genesis() { # id mode
  ./scripts/genesis-devnet.sh --launch "$1" --mode "$2" --cluster devnet --core "$KRUXA_CORE" --squads-multisig "$SQUADS" \
    --record "evidence/genesis/core3-$(echo "$2" | tr 'A-Z' 'a-z')-devnet-launch$1.json" --holders-file "$HOME/.kruxa-secrets/genesis/holders-core3-$1.json" \
    | tee "evidence/genesis/core3-$(echo "$2" | tr 'A-Z' 'a-z')-devnet-launch$1.log"
  mkdir -p evidence/genesis/core3 # verify.sh <id> reads $KRUXA_GENESIS_PREFIX<id>.json
  cp "evidence/genesis/core3-$(echo "$2" | tr 'A-Z' 'a-z')-devnet-launch$1.json" "evidence/genesis/core3/genesis-$1.json"
}
case "${1:-}" in
  A|B|C|D|E|F|G|H) node "$CT/seed.mjs" "$1" ;;
  settle) ./scripts/keeper.sh "${2:?launch id}" --yes ;;
  genesis) genesis "${2:?launch id}" "${3:?F0 or F1}" ;;
  market) node "$CT/market-flow.mjs" "${2:?launch id}" ;;
  all)
    node "$CT/seed.mjs" A; ./scripts/keeper.sh "$(launch_id A)" --yes; genesis "$(launch_id A)" F0
    node "$CT/seed.mjs" B; ./scripts/keeper.sh "$(launch_id B)" --yes
    node "$CT/seed.mjs" C; ./scripts/keeper.sh "$(launch_id C)" --yes; node "$CT/market-flow.mjs" "$(launch_id C)"; genesis "$(launch_id C)" F1 ;;
  *) echo "usage: seed-demo.sh A|B|C|all | settle <id> | genesis <id> F0|F1 | market <id>" >&2; exit 64 ;;
esac
