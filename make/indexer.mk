# Indexer workstream targets. The root Makefile must `-include make/*.mk` (owned by workstream D).
.PHONY: indexer-demo indexer-test indexer-typecheck

indexer-demo:
	@cd services/indexer && NODE_NO_WARNINGS=1 node src/demo.ts

indexer-test:
	@cd services/indexer && NODE_NO_WARNINGS=1 node --test --test-concurrency=4 test/*.test.ts
	@cd services/api && NODE_NO_WARNINGS=1 node --test --test-concurrency=4 test/*.test.ts

indexer-typecheck:
	@cd services/indexer && npx tsc --noEmit -p .
	@cd services/api && npx tsc --noEmit -p .
