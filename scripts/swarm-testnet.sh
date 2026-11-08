#!/usr/bin/env bash
# make swarm-testnet: NOT IMPLEMENTED.
# It will replay the same 16 scripted agents as real calls against the Kruxa core contract once that contract is
# deployed on NEAR testnet (16 funded sub-accounts, the same commit/walk/settle schedule, the same invariants read back
# from the contract's view methods). Nothing in this repo does that yet, and this script does not pretend to.
# Exit code 2 on purpose so no pipeline mistakes it for a pass.
echo "swarm-testnet: NOT IMPLEMENTED. Blocked on the core contract being deployed on testnet." >&2
echo "Use 'make swarm' for the offline simulation. See swarm/README.md." >&2
exit 2
