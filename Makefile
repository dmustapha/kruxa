.PHONY: thesis judge-fast test-unit sim build lint test verify-claims judge tour claimed-tracks lint-readme

test-unit:
	cargo test -p kruxa-math -p kruxa-logic

# Memecoins track step: three volume scenarios, the supply table, BOUND OK and a SIM sha256 line (evidence/sim.txt).
sim:
	cargo run -q -p market-sim -- sim 60

build:
	./scripts/build.sh

lint:
	./scripts/lint.sh

test:
	./scripts/test.sh --include-ignored

verify-claims:
	./scripts/verify-claims.sh

# The whole judge path: sandbox only, no keys. Includes `make tour`. Prints a per-track GREEN/RED table.
# `make judge JUDGE_ARGS=--record` also writes evidence/judge-run.txt.
judge:
	./scripts/judge-run.sh $(JUDGE_ARGS)

# Fast subset (about 10 minutes cold, no track claims). `make judge` is the full run.
judge-fast:
	./scripts/judge-run.sh --fast

# Seven offline scenes on their own (also step O1 of `make judge`).
tour:
	./scripts/tour.sh

# Tracks that may be listed, derived from the last `make judge` table. `make claimed-tracks ARGS=--json` writes submission/track-claims.json.
claimed-tracks:
	./scripts/claimed-tracks.sh $(ARGS)

lint-readme:
	./scripts/readme-lint.sh --evidence README.md

# One fragment per workstream (PLAN C3.3): make/<ws>.mk
-include make/*.mk

# Investment Thesis pack: offline rebuild from committed snapshots (Python 3 standard library only). Ends with THESIS OK.
thesis:
	$(MAKE) --no-print-directory -C thesis thesis
