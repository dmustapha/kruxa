# swarm

Offline crowd test for Kruxa: 16 scripted agents (7 honest, 9 adversaries) over 24 rounds against the real `kruxa-logic` verdict and allocation functions, invariants asserted after every round.

| Command | What it does |
|---|---|
| `make swarm` | Offline, no network. Prints seed 1 (24 `INV OK` lines, agent table, aggregate), checks the committed runs reproduce byte for byte, sweeps 300 seeds. Exit 0 only if every invariant held. |
| `make swarm-test` | `cargo test -p swarm-sim` (19 tests, including tests that inject deliberate bugs and require the checker to catch them). |
| `make swarm-record` | Regenerate `runs/run-1.json` to `run-3.json`. |
| `make swarm-testnet` | SW-2 runner. Default is PLAN ONLY (prints every command, sends nothing). With `--yes` and `NEAR_ENV=testnet` it replays a recorded run as real calls from 16 sub-accounts and compares the on-chain totals and verdict with the recorded run. Written but not yet run on a live network. |
| `make swarm-crowd-test` | Writes `docs/interfaces/swarm-crowd-test.json`, the digest of the three committed runs that the app's crowd-test panel reads (`ARGS=--check` verifies it is current). |

Read `RULES.md` for the game, the agents, the invariants, and what is blocked versus only bounded. The JSON shape is in `docs/interfaces/SWARM-OUTPUT.md`.
