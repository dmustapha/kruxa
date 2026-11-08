# Instant launcher targets (workstream L). The root Makefile includes make/*.mk.
.PHONY: instant-build instant-test instant-sandbox

instant-build:
	./scripts/instant-build.sh

instant-test:
	cargo test -p kruxa-instant

instant-sandbox: instant-build
	cargo test -p kruxa-tests --test instant --test instant_adversarial -- --test-threads=4
