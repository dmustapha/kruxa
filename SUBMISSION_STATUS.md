# Submission status
_Last updated: CHANGE-ORDER-5 doc-sync, 2026-11-08 (after forge Phase 3, CHANGE-ORDER-3 and CHANGE-ORDER-4)_

## Status
- [x] Pure crates `kruxa-math` and `kruxa-logic` compile and pass 50 unit and property tests (rustc 1.95.0, local run)
- [x] Core contract builds to wasm with cargo-near 0.23.0 (462,222 bytes) and passes 34 sandbox tests against mock USDC, mock Intents and mock factory (local run)
- [x] Lifecycle verified in the sandbox: create, commit (native and S3), S4 forward, Walk (key and signature), settle PASS (under- and oversubscribed) and FAIL, refunds, claims, consolidation, launch fee, `STREAM_CAP`
- [x] Adversarial cases for every reachable `R_*` code, callback re-credit, fake token, direct callback, pause and freeze
- [x] `scripts/verify.sh golden` reproduces the S1-B boundary vectors and example 1
- [x] App builds (`/`, `/create`, `/launch/[id]`, `/demo`); TypeScript mirror matches the Rust hashes
- [x] ARCHITECTURE.md, DECISIONS.md, LIMITATIONS.md written; ARCHITECTURE.md round-trips to the compiled workspace
- [ ] Repo scaffolded from ARCHITECTURE.md by build (`scripts/extract_architecture.py`)
- [ ] Wave 0: S3 against the real `intents.near` wasm in the sandbox
- [ ] Wave 0: testnet probe of the token factory (`create_token` cost, excess refund, `ft_burn`)
- [ ] Deployed to NEAR testnet; `verify.sh chain` run on a PASS and a FAIL launch
- [ ] Wave 2: Solana genesis, Merkle distributor, Squads reserve
- [ ] Market-lite (scope M-A) on testnet, M-gate Nov 11 EOD (CO-3; Hold Vault stays later)
- [ ] Demo seeded launches A, B, C; README with do-X-see-Y steps; X post; repo public; submission form

## Known limitations / blockers
- The real `intents.near` and the real token factory have not been called by this code. Reason: safety and cost; W0 is a source read. Blocker for the claim "works on mainnet".
- The wasm was loaded by the protocol-88 sandbox only. Reason: no testnet deployment yet. Mainnet also reports protocol 88 [VERIFIED 2026-11-08, curl `status`], so the earlier protocol-87 concern is removed; real-network acceptance is still unverified until the testnet deploy.
- A live S3 test and Phantom `signMessage` byte-exactness are unproven. Reason: needs Dami's per-action confirmation and funding for the approved <= $1 test.
- Charter has fee terms but no payees, creator-allocation vesting or LP-token distribution. Reason: scope (Wave 3); fee terms are inert until the market exists.
- No async solvency anchor, no token burn for failed launches, claimants must register on the launch token first. Reason: scope; designed in ARCHITECTURE.md 5.6.
- The wasm is 462,222 bytes against a 350 KB budget. Reason: JSON `Value` views; locks about 4.57 NEAR of storage stake.
- Gas constants are estimates and the 7-day freeze expiry is tested only as a pure function. Reason: a 7-day sandbox fast-forward is impractical (100,000 blocks did not finish in 4 minutes).
- The app has not been opened in a browser or connected to a wallet. Reason: phase scope.
- Open rulings (waiting on Dami): relay-fee ceiling (5% / $0.50 implemented, 1% suggested), the 2x oversubscription ceiling, reserve split, storage payer, pool and LP-seed amounts, USDC payout address, README headline, brand-token supply, and Squads independents (BLOCKER BLK-1 for third-party creators only; Dami: "when we get there"). RULED on 2026-11-08 and closed: fee split 50/15/15/10/10, round-one LP seed 100% on the NEAR pool, hosting tier 2 through Nov 25, market reserve caps $5,000 / $15,000 (interim), beta access (open under caps after BLK-1). Reason for the open list: ARCHITECTURE.md 3.2, PRD 9.4.
- Rust toolchain: the machine default is 1.91.1; 1.95.0 was installed alongside for this run and must be installed on any build machine. Reason: near-sdk 5.30.1 requirement.
- Any mainnet step, repo publication, X post and the one-shot submission are not done. Reason: each requires Dami's per-action confirmation.

## CHANGE-ORDER-3 additions (all unchecked: nothing below is built or run)
- [ ] Core deltas D-1 (creator gate) and D-3 (`open_market` handoff) merged; Wave 1 suite re-run; core wasm frozen Nov 10 EOD
- [ ] Meteora devnet spike result (pass/fail per check) in `spikes/meteora/RESULT.md` by Nov 10 midday
- [ ] Nov 10 EOD Genesis Round go/no-go run (`gate-g3.sh`); result recorded
- [ ] Indexer, candles, trades feed, launch feed API; hosting tier 2 up
- [ ] Wallet layer (near-connect pinned and verified; Solana chooser)
- [ ] Payout recipient visible in Studio, trial page and Creator Desk; earnings CSV
- [ ] $KRUXA trial opened on mainnet (target Nov 11 12:00 UTC, latest 18:00); settled; genesis; `verify.sh` exit 0 on it
- [ ] M-gate (Nov 11 EOD) and market on mainnet; B-gate (Nov 12 EOD) and capped beta opened
- [ ] Per-track claim checklist (PLAN C3.9) green rows only: memecoins, security, open, defi, swarms, agents (tier B conditional); tier C not listed by default
- BLOCKER BLK-1: two named independent Squads signers. Owner Dami. Dami: "id name 2 friends when we get there": needed before third-party creators open on mainnet, NOT for the Genesis Round. Plan latest Nov 11 EOD [ASSUMED]. Fallback: beta stays closed, testnet open.

## CHANGE-ORDER-5 additions (doc-sync; all unchecked unless stated)
- [x] Fee split 50/15/15/10/10 applied in the docs (RULED); [ ] constants D-4 (platform 1_500, standard preset) built and the full Wave 1 suite re-run
- [x] Hosting tier 2 RULED (through Nov 25, minimum Nov 18); [ ] hosting accounts and domain (Dami, Nov 10)
- [ ] Three separate hardware wallets in hand by Nov 10 (the Squads vault is created at the gate; order now if not owned)
- [ ] Test 1: funded in part (T1 SOL 0.005, T1 NEAR 0.02; target 0.15 NEAR from held funds, no new money); Dami runs `register`, `get-usdc-t1` and `all` with the `!` prefix; NOT run. If not run by Nov 10 12:00 the Solana-landing claims are dropped
- [ ] Dated Dami credentials (never in chat): NEAR AI Cloud key Nov 9 12:00 UTC; GCP project and key file Nov 9 18:00 UTC; Intents partner JWT Nov 9 18:00 UTC; thesis dropped at Nov 10 12:00 UTC if unusable
- [ ] Per-track claim list (CO-4, freeze rule each): memecoins (`make sim` BOUND OK); security (tamper exit 2, gallery 11+ of 13 with rule codes, guard BLOCKED); open (`judge-run.sh` and `make tour` green); defi (dry quote 201 and `SLICES OK`; cross-chain wording only with a committed Test 1); swarms (`make swarm` 24 of 24); agents (6+ real testnet tx hashes, one `V_` rejection, `make receipts-verify` green); thesis conditional (snapshots, `make thesis`, evidence-against by Nov 12 20:00 UTC); nfts and business NOT listed
- [ ] CO-4 modules built and green: agentkit, agent vault (testnet), Launch Check, attack gallery, swarm simulator, thesis pack; pages `/security`, `/swarm`, thesis dashboard
- [ ] No-funds judge path green: `scripts/judge-run.sh`, `claimed-tracks.sh`, dry quote, recorded mainnet receipts, replayed model runs (RECORDED)
- Latest open time for the $KRUXA trial: target Nov 11 12:00 UTC (LP-seed release would be Nov 14 16:00), latest 18:00 (Nov 14 22:00); after about 20:00 any Solana release lands past the deadline (PRD 8.3). Round one seeds the NEAR pool only, so this binds only a later Solana share.
- Gate names (PRD 9.3): Genesis Round gate Nov 10 EOD; M-gate Nov 11 EOD; B-gate Nov 12 EOD.
- Pending recommendations, NOT decided: DN-26 to DN-32 (opening-fee start, agent vault, venue builder deferral, thesis promotion, business tier C, model choice, six concurrent agents).
- [ ] Arcos (DN-25): Dami to supply a link or screenshot; default dropped.
