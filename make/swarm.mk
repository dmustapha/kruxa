# Swarm simulator (workstream T1). The root Makefile includes make/*.mk.
.PHONY: swarm swarm-test swarm-record swarm-testnet

# Offline, no network. Exit 0 only if every invariant held in every round, the recorded runs reproduce, and the sweep is clean.
swarm:
	@./scripts/swarm-run.sh

swarm-test:
	cargo test --offline -p swarm-sim

# Regenerate swarm/runs/run-1..3.json (deterministic; commit the result).
swarm-record:
	@./scripts/swarm-record.sh

# NOT IMPLEMENTED. Documented stub: needs the core contract deployed on testnet. Exits 2 on purpose.
swarm-testnet:
	@./scripts/swarm-testnet.sh
