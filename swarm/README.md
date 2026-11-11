# swarm

Offline crowd test for Kruxa: 16 scripted agents (7 honest, 9 adversaries) over 24 rounds against the real `kruxa-logic` verdict and allocation functions, invariants asserted after every round.

| Command | What it does |
|---|---|
| `make swarm` | Offline, no network. Prints seed 1 (24 `INV OK` lines, agent table, aggregate), checks the committed runs reproduce byte for byte, sweeps 300 seeds. Exit 0 only if every invariant held. |
| `make swarm-test` | `cargo test -p swarm-sim` (19 tests, including tests that inject deliberate bugs and require the checker to catch them). |
| `make swarm-record` | Regenerate `runs/run-1.json` to `run-3.json`. |
| `make swarm-testnet` | SW-2 runner (`scripts/swarm-testnet.mjs`, wrapper `scripts/swarm-testnet.sh`). Default is PLAN ONLY (prints every step, sends nothing). With `--yes` and `NEAR_ENV=testnet` it creates 16 throwaway sub-accounts under the core3 root, replays a recorded run against `core3` as real calls and compares the on-chain totals, verdict, settlement and per-agent positions with the recorded run (`SWARM-TESTNET GREEN` or `RED`, plus tx count). Live runs 2026-11-11 (`KXI_CORE` points at a fresh core, since each replay holds up to 1,000 USDC of the 3,000 global cap): seed 1 GREEN 56 of 56 on core4, seed 2 GREEN 51 of 51 and seed 3 GREEN 49 of 49 on core6 (`--round-secs 20`; the default 10 s rounds are tight against RPC latency and a late event shows as RED, never as a pass). See `evidence/swarm-testnet/`. |
| `make swarm-crowd-test` | Writes `docs/interfaces/swarm-crowd-test.json`, the digest of the three committed runs that the app's crowd-test panel reads (`ARGS=--check` verifies it is current). |

Read `RULES.md` for the game, the agents, the invariants, and what is blocked versus only bounded. The JSON shape is in `docs/interfaces/SWARM-OUTPUT.md`.
