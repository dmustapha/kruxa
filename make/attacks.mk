# Attack gallery targets. The root Makefile includes make/*.mk.
.PHONY: attack-gallery attack-gallery-red

# Runs every attack against the real core and market wasm in the near-workspaces sandbox.
# Exits 0 only if every attack was refused (or ran and achieved nothing, or is a disclosed bound) and all invariants held.
attack-gallery:
	./scripts/attack-gallery.sh

# Red-mode proof: one attack is made to succeed on purpose (test-only switch); this target must exit NON-zero.
attack-gallery-red:
	./scripts/attack-gallery.sh --sabotage A11

.PHONY: known-findings
# Reproductions of the independent review against the current code. Exits 1 while any finding is EXPLOITABLE.
known-findings:
	./scripts/known-findings.sh
