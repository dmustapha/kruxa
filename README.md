# Kruxa

A token launchpad on NEAR where a launch is a refundable trial: buyers can walk away until the deadline, and a fixed rule that anyone can recompute decides whether the launch happens. Prove it on your own machine with no keys and no funds: `make judge`.

Built for NEAR HACKATHON: Build Beyond Boundaries. The judge path runs in a local NEAR sandbox and on recorded data. Nothing here is on mainnet.

## What it is

- **Trial.** A creator opens a launch with fixed terms: caps, windows, creator stream rate. The terms are hashed into a Charter at creation and cannot change.
- **Commit and Walk.** Buyers commit USDC. Until the walk deadline each buyer can Walk and the contract returns the committed principal with no contract fee. Moving it off NEAR through Intents costs a quoted withdrawal fee.
- **Verdict.** After the commit window anyone calls `settle`. PASS needs total committed at or above the soft cap and enough distinct funders. One micro-USDC short is a FAIL. `settle` reads stored state only, so the creator cannot influence it.
- **After the verdict.** FAIL refunds everyone. PASS refunds any oversubscribed excess pro rata at one uniform price, and the creator's proceeds then stream at a capped rate (`STREAM_CAP`), never faster.
- **Market.** After a PASS, a pool inside the market contract trades the token with a decaying opening fee and a five-way fee split. It runs in the sandbox and as a testnet demo.
- **Solana mint.** On PASS the Solana token is a fixed-supply mint with null mint and freeze authority, created in a one-time ceremony that a script re-checks from public data. Here that ran on Solana devnet only, signed through NEAR Chain Signatures.
- **Instant mode (testnet only):** a second launch mode with no trial and no refund, built and run end to end on NEAR testnet against a mock token factory on a 10-second demo clock (`evidence/instant-testnet/`, `docs/runbooks/instant-testnet.md`); it was not run through the real token factory and is not on mainnet.

## Try it

Needs macOS or Linux, Rust 1.95.0 (pinned by `rust-toolchain.toml`), cargo-near 0.23.0, python3, jq and curl. Docker is not needed.

Network use is stated, not hidden. Step N1 fetches crates and makes one read-only `view_code` call to a mainnet RPC node for the hash-pinned `intents.near` wasm (no signature, no transaction). Step N2 compiles the tests, and on a cold machine a cargo build script downloads the NEAR sandbox binary. Every later step runs with `CARGO_NET_OFFLINE=true`. No step reads a key; credential-shaped environment variables are removed before the first step.

1. In the repository root, run the whole judge path. It builds the contracts, runs the core, market and launcher in a sandbox, runs the attack gallery, the tamper checks, the swarm and the tour, and prints a per-track table.

```bash
make judge
```

Expected: every step GREEN, then the verdict line, then the tracks Kruxa lists.

```expected
JUDGE RUN GREEN
```

2. Print the tracks this README may list. They come from the GREEN rows of step 1 and are not typed by hand.

```bash
make claimed-tracks
```

3. Check this README against the run (em-dashes, placeholders, claims for tracks that are not GREEN, output strings that are not in `evidence/`).

```bash
make lint-readme
```

Expected: the last line reads `README LINT OK`.

## Do X, see Y

Each command runs alone once `make judge` has built everything.

**Verdict at the boundary.** The rule is exact: PASS at the soft cap, FAIL one micro-USDC below, and a 100 USDC buyer in an oversubscribed launch spends 40 and is refunded 60.

```bash
./scripts/verify.sh golden
```

```expected
outcome=PASS
outcome=FAIL(reasons=1)
spend=40000000 refund=60000000
```

**Tamper is caught.** Replay a recorded launch lifecycle, then change one micro-USDC in the record. The clean replay matches; the changed one prints MISMATCH and exits 2.

```bash
make tour
```

```expected
TOUR 1/7 hostile preset refused: R_ALLOC R_WINDOW
TOUR GREEN
```

```bash
cargo run -q -p kruxa-sim -- fold --events fixtures/events/lifecycle.jsonl --book-hash "$(cat fixtures/events/lifecycle.book_hash)" --tamper
```

```expected
MISMATCH log (event 30: walk of 40000000, holder had 40000001)
```

**Recorded Solana devnet genesis re-checks clean.** The record is replayed offline against the real testnet core's recorded views.

```bash
./scripts/verify.sh --evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json
```

```expected
RECORDED, not live (evidence evidence/genesis/core2-f0-devnet-launch6-evidence.json)
PASS C7 mint_authority=None freeze_authority=None
```

**Market fee split.** Five fee slices add up, the pool constant holds, and the creator never takes more than half the fee.

```bash
make market-demo
make market-sim
```

```expected
SLICES OK
BOUND OK: creator never above 50% of the fee (creator 298.59 of fee 636.47)
```

**Swarm.** Sixteen scripted agents, honest backers and adversaries we wrote, 24 rounds.

```bash
make swarm
```

```expected
INVARIANTS HELD in 24 of 24 rounds and at settlement
SWARM GREEN
```

**Attack gallery.** About ten minutes. It regenerates `docs/ATTACK-GALLERY.md` and `evidence/attack-gallery/`; `make judge` restores the committed copies afterwards.

```bash
make attack-gallery
```

## Tracks

The tracks listed for this submission are the GREEN rows of `make judge`, copied by `make claimed-tracks`. `make lint-readme` fails if this README names a track that is not GREEN.

- **Memecoins With Mechanics.** The mechanic is verdict-gated existence: Walk, a deterministic verdict, pro rata refunds and a capped creator stream. Steps V1, C1, M1, M2, M3, U1.
- **AI Security & Defense.** Tamper detection with distinct exit codes, and an attack gallery in which our own scripted attackers try the contracts and every attack is refused, harmless or a disclosed bound. The attackers are tests, not AI agents, and this is our red team, not an independent audit. Steps T1 to T5, A1.
- **AI Swarms.** An offline crowd simulator with honest and adversarial agents, invariants checked every round, recorded runs that reproduce byte for byte. The agents are scripted, not language models. Step W1.
- **Open Innovation.** The whole platform end to end in one command, `make judge`, with `make tour` inside it. Every step.

### Not claimed

- **Unstoppable DeFi.** The dry quote needs a live Intents endpoint, and the evidence files for the live Intents tests are not committed. Live Intents behaviour, including solver latency, is not evidenced in this repository. Not claimed.
- **Investment Thesis.** The thesis pack is not in this repository and there is no `make thesis` target.
- **Agent Economy.** Cut. No agent module is built.
- Privacy & Private AI, Autonomous Business, Real-World Money, Games With Real Economies, NFTs That Do Something, Social Money: no module exists.

## What uses NEAR

| Technology | What it does here | What is verified |
|---|---|---|
| NEAR smart contracts (near-sdk 5.30.1) | Trial core, market and launcher contracts in `contracts/` | Sandbox suites C1, M1, I1 of `make judge` |
| NEAR Intents | Backers commit from other chains through `mt_on_transfer` on the `intents.near` Verifier | The sandbox loads the real `intents.near` wasm, pinned by code hash (`tests/tests/real_intents.rs`). No live Intents call is part of the judge path |
| NEAR Chain Signatures | The contract asks the MPC signer to sign the Solana genesis transactions, only if they equal a compiled spec | Devnet record replayed by `verify.sh --evidence` (T3, T4). Devnet only |
| NEAR token factory (`token.primitives`) | Launch tokens | A testnet probe is recorded in `evidence/factory-probe.txt`. The sandbox uses a mock factory |
| NEAR testnet | Demo deployments | The core wasm built by `make judge` has the same sha256 as the code on `core2.kxa1-owner-1203.testnet` (`docs/runbooks/testnet-core2.md`); the market and launcher on testnet are earlier builds |

## Limits, stated plainly

- The judge path is a sandbox plus recorded data. It is not a live network, and sandbox transaction hashes cannot be looked up on an explorer.
- Nothing is deployed on mainnet and no mainnet token exists. The contracts have had no independent audit. Phase 0 keeps an upgrade key with the builder (`SECURITY.md`).
- Sybil wallets are not defended against: `min_funders` counts accounts, not people.
- The web app in `app/` is not part of the judge path. It has not been exercised against a live wallet, and Phantom message signing is unproven (`SUBMISSION_STATUS.md`).
- The factory token's publisher can replace the token code, and the Intents Verifier holds force powers over money inside `intents.near`. Both are disclosed in `SECURITY.md`.
- The market contract is new and unreviewed. The launch fee and fee split are demonstration values.
- Launch terms are bounded by a $1,000 cap per launch and a $3,000 global cap on the demo profile.
- The core wasm is 571,087 bytes, above the 350 KB size budget we set.

## Repository map

| Path | Contents |
|---|---|
| `contracts/` | `core` (trial), `market`, the launcher, mocks |
| `crates/` | Pure Rust logic shared by contracts and tools |
| `tools/` | `kruxa-sim` (verify and replay), `market-sim`, `swarm-sim`, Solana genesis tools |
| `scripts/` | `judge-run.sh`, `tour.sh`, `claimed-tracks.sh`, `readme-lint.sh`, `verify.sh` |
| `tests/` | Sandbox suites and the attack gallery |
| `evidence/` | Recorded runs: judge run, attack gallery, Solana devnet genesis, launcher testnet runs |
| `docs/`, `ARCHITECTURE.md`, `SECURITY.md`, `LIMITATIONS.md`, `HONESTY.md` | Design, threats and every disclosure |
