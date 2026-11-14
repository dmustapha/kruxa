# Proof sheet (two minutes)

For a judge or an AI judge. Every command below needs no keys and no funds. Every expected line is checked by `scripts/fill-submission.sh` against a committed file under `evidence/`, so a line that is not in the evidence cannot ship here. Repo head when this sheet was filled: `{{GIT_HEAD_SHORT}}`.

Setup: macOS or Linux, Rust 1.95.0 (pinned by `rust-toolchain.toml`), cargo-near 0.23.0, python3, jq, curl (`README.md` "Try it"). Docker is not needed.

## The one-line check

```bash
make judge-fast
```

```expected
FAST subset: {{FAST_STEPS}} steps green, wall {{FAST_WALL_S}}s.
```

Recorded in `evidence/judge-fast-run.txt` (the wall time is that machine's, yours differs). The full run, `make judge`, prints this on the recorded run (`evidence/judge-run.txt`, commit `{{JUDGE_GIT_SHORT}}`):

```expected
JUDGE RUN GREEN  ({{JUDGE_STEPS}} steps green, wall {{JUDGE_WALL_S}}s)
```

## Checks, one per claim

| # | Claim | Command | Expected line | Transcript |
|---|---|---|---|---|
| 1 | PASS at the soft cap, FAIL one micro-USDC below, a 100 USDC buyer in an oversubscribed launch spends 40 and gets 60 back | `./scripts/verify.sh golden` | see block 1 | `evidence/judge-run.txt` (step V1); `CLAIMS.md` C-01 to C-03 |
| 2 | Seven offline scenes run end to end | `make tour` | see block 2 | `evidence/judge-run.txt` (step O1) |
| 3 | Change one micro-USDC in a recorded launch and the verifier catches it | `cargo run -q -p kruxa-sim -- fold --events fixtures/events/lifecycle.jsonl --book-hash "$(cat fixtures/events/lifecycle.book_hash)" --tamper` | see block 3 | `evidence/judge-run.txt` (step T2); `evidence/verify-tamper.txt` |
| 4 | A recorded Solana devnet genesis re-checks clean offline | `./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json` | see block 4 | `evidence/judge-run.txt` (step T3) |
| 5 | Market fees split five ways and the creator never takes more than half the fee | `make market-demo` and `make market-sim` | see block 5 | `evidence/judge-run.txt` (steps M2, M3) |
| 6 | Sixteen scripted agents, 24 rounds, invariants hold every round | `make swarm` | see block 6 | `evidence/judge-run.txt` (step W1) |
| 7 | Our own red team ran 100 attacks on a sandbox (not an audit) | `make attack-gallery` (about 10 minutes) | see block 7 | `evidence/judge-run.txt` (step A1); `docs/ATTACK-GALLERY.md` |
| 8 | The wasm on the testnet core is the reproducible build in `artifacts/` | `./scripts/verify.sh near-ops --rpc https://test.rpc.fastnear.com --contract {{CORE_ACCOUNT}}` (read-only, live) | see block 8 | `evidence/verify/claims-C05-core7.txt` and `evidence/testnet-core7/` are the record for the previous account name; a refreshed record for the final core goes next to them |

Block 1:

```expected
outcome=PASS
outcome=FAIL(reasons=1)
spend=40000000 refund=60000000
```

Block 2:

```expected
TOUR 1/7 hostile preset refused: R_ALLOC R_WINDOW
TOUR 7/7 swarm: 16 agents, adversaries bounded, invariants hold every round
TOUR GREEN
```

Block 3:

```expected
MISMATCH log (event 30: walk of 40000000, holder had 40000001)
```

Block 4:

```expected
RECORDED, not live (evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json)
MISMATCH mint (tamper detected)
```

(The second line comes from the tamper run of the same record, `./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json --tamper-all`, step T4. The first run prints `PASS C7 mint_authority=None freeze_authority=None`, in `evidence/verify-tamper.txt`.)

Block 5:

```expected
SLICES OK
BOUND OK: creator never above 50% of the fee (creator 298.59 of fee 636.47)
```

Block 6:

```expected
INVARIANTS HELD in 24 of 24 rounds and at settlement
SWARM GREEN
```

Block 7:

```expected
ATTACK GALLERY (sandbox): 100 attacks run, 81 refused with a rule code, 14 ran with no effect, 5 bounded (disclosed limits), 0 failed, 0 succeeded unexpectedly; invariants held in 100/100; 10 not done (see not_done); KNOWN FINDINGS (separate, see docs/KNOWN-FINDINGS.md for pre-fix and current): 0 exploitable, 5 not exploitable, 1 not reproduced (see docs/KNOWN-FINDINGS.md)
```

Block 8 (the second line is a disclosure, not a pass; read it):

```expected
NOTE: a full-access key is present, so its owner can redeploy this contract.
CODE: view_code sha256 {{CORE_SHA256}}; reproducible build sha256 {{CORE_SHA256}}; MATCH
```

## Hashes (filled from `artifacts/SHA256SUMS`)

| Artifact | sha256 | Note |
|---|---|---|
| `artifacts/kruxa_core.wasm` | `{{CORE_SHA256}}` ({{CORE_BYTES}} bytes) | container build from commit `{{CORE_BUILD_COMMIT_SHORT}}`, two runs identical (`artifacts/BUILD-KIND`) |
| `artifacts/kruxa_market_contract.wasm` | `{{MARKET_SHA256}}` | local build, not reproducible (`artifacts/BUILD-KIND`) |
| `artifacts/kruxa_instant_contract.wasm` | `{{LAUNCHER_SHA256}}` | local build, not reproducible (`artifacts/BUILD-KIND`) |

Step B1 of `make judge` builds the core locally and prints a different hash, `{{JUDGE_LOCAL_CORE_SHA256_SHORT}}...` (`evidence/judge-run.txt`). Same source, different toolchain. The judge run does not rebuild the deployed bytes; the container build does and needs Docker (`LIMITATIONS.md` limit 9).

## Live testnet accounts

| Role | Account | Explorer |
|---|---|---|
| Core | `{{CORE_ACCOUNT}}` | {{CORE_EXPLORER_URL}} |
| Market | `{{MARKET_ACCOUNT}}` | see `submission/links.md` |
| Instant launcher | `{{LAUNCHER_ACCOUNT}}` | see `submission/links.md` |

These hold play money (mock USDC, mock Intents, mock factory on the main path). Sandbox transaction hashes cannot be looked up on an explorer (`README.md` "Limits, stated plainly").

## What this sheet does not prove

Each item is a disclosed limit with its file. None of it is hidden here.

- Nothing is on mainnet (`SUBMISSION_STATUS.md` section 1).
- No independent audit; the gallery is our own red team (`LIMITATIONS.md` limit 7).
- The owner full-access key can redeploy the testnet core and bypass the upgrade queue (`LIMITATIONS.md` limit 1).
- The judge path is a sandbox plus recorded data, not a live network (`README.md`).
- Live Intents behaviour and Phantom signing are not evidenced to a re-runnable standard (`CLAIMS.md` last paragraph, `README.md` "Not claimed").
- The agents and attackers are scripted, not language models (`README.md` "Tracks").
