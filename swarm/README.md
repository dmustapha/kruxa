# swarm

Offline crowd test for Kruxa: 16 scripted agents (7 honest, 9 adversaries) over 24 rounds against the real `kruxa-logic` verdict and allocation functions, invariants asserted after every round.

| Command | What it does |
|---|---|
| `make swarm` | Offline, no network. Prints seed 1 (24 `INV OK` lines, agent table, aggregate), checks the committed runs reproduce byte for byte, sweeps 300 seeds. Exit 0 only if every invariant held. |
| `make swarm-test` | `cargo test -p swarm-sim` (19 tests, including tests that inject deliberate bugs and require the checker to catch them). |
| `make swarm-record` | Regenerate `runs/run-1.json` to `run-3.json`. |
| `make swarm-testnet` | NOT IMPLEMENTED. Needs the core contract deployed on testnet. Exits 2 on purpose. |

Read `RULES.md` for the game, the agents, the invariants, and what is blocked versus only bounded. The JSON shape is in `docs/interfaces/SWARM-OUTPUT.md`.
