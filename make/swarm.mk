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

# SW-2: plan-only by default; `ARGS=--yes` with NEAR_ENV=testnet replays a recorded run as real testnet calls (ops agent runs it).
swarm-testnet:
	@./scripts/swarm-testnet.sh $(ARGS)

# Digest of the three committed runs for the app's crowd-test panel: docs/interfaces/swarm-crowd-test.json (`ARGS=--check` verifies it is current).
.PHONY: swarm-crowd-test
swarm-crowd-test:
	@python3 -I tools/swarm-sim/export-crowd-test.py $(ARGS)
