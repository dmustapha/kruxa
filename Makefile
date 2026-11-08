.PHONY: test-unit sim build lint test verify-claims judge tour claimed-tracks lint-readme

test-unit:
	cargo test -p kruxa-math -p kruxa-logic

sim:
	./scripts/verify.sh golden
	cargo run -q -p market-sim -- table 60

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
