# Market workstream targets. The root Makefile includes make/*.mk.
.PHONY: market-build market-test market-demo market-sim market-sandbox

market-build:
	./scripts/market-build.sh

market-test:
	cargo test -p kruxa-market

market-sandbox: market-build
	cargo test -p kruxa-tests --test market_sandbox --test market_adversarial -- --test-threads=4

market-demo:
	@./scripts/market-demo.sh

market-sim:
	@cargo run -q -p market-sim -- table 60
