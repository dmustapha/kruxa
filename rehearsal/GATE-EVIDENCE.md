# Gate evidence (read by scripts/gate-g3.sh; one line per row: | GR-n | PASS/FAIL/WAIVED | time | detail |)

| GR-2 | PASS | 2026-11-10T01:00Z | scripts/gate-g2.sh GREEN 9 of 9 on core3.kxi-root-1108.testnet (evidence/testnet-core3/gate-g2.txt); verify exit 0, tamper-all exit 2, dead RPC exit 4, FAIL launch prints the no-mint line. G2-01 read the logs of the NAMED gate tests only (not the full gate-g1 suite) |
| GR-12 | PASS | 2026-11-10T02:00Z | F0 through the core gate (register_f0_message, sign_genesis, predecessor = core3) ran 3 of 3 on devnet: launches 2, 5, 6 (evidence/genesis/core3-f0-devnet-launch2, 5, 6; verify exit 0; C27 derive(core3, kruxa:genesis:N)). F1 also run once: launch 4 |
| GR-16 | PASS | 2026-11-10T01:00Z | market3.kxi-root-1108.testnet opened for launches 4 and 6 through core open_market; buy, claim_owed, buy, sell; pool and market invariants true (evidence/testnet-core3/txlog.jsonl, market-flows.json) |
