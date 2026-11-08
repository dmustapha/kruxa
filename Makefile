.PHONY: test-unit sim build lint test verify-claims judge

test-unit:
	cargo test -p kruxa-math -p kruxa-logic

sim:
	./scripts/verify.sh golden

build:
	./scripts/build.sh

lint:
	./scripts/lint.sh

test:
	./scripts/test.sh --include-ignored

verify-claims:
	./scripts/verify-claims.sh

judge:
	./scripts/judge-run.sh
