# X post fact sheet

This is NOT a post. The owner writes the post in his own voice and approves it before it goes out (brief section 6, `/Users/MAC/.claude/skills/hackathon-briefs/near.md`). This sheet lists what the repo lets him say, and what it does not.

Run `scripts/fill-submission.sh` first and read the filled copy in its output directory (default `../kruxa-submission-filled/`, outside the repo).

## Demo-post constraints from the brief

| Constraint | Source |
|---|---|
| The X demo post is a judged deliverable | brief section 2 item 3 |
| It must be public, carry video or screenshots, and mention it was built for NEAR HACKATHON | brief section 2 item 2 |
| Its URL goes into the one-shot form field "public demo post on X" (field 10 in `submission/FORM-PAYLOAD.md`) | brief section 2 item 2 |
| It goes out on the owner's account; his approval comes first | brief section 6 |
| Timing: X post and repo public by Nov 13 (internal cutoff); submit Nov 14 well before 23:59 UTC | brief section 14 |
| Video length target: under 90 seconds | `/Users/MAC/near-hack/kruxa/OUTSTANDING-2026-11-14.md` item SP7 (`submission/video-script.md` is built to it) |
| Community handles listed in the brief: @NearBuilders, @NEAR_hckthn; hashtag #NEARHACKATHON | brief section 1 (Community) and section 11 (intel) |

Not stated by the brief, so the owner decides: the text length, whether to tag the handles above, and whether to name sponsors or judges. Do not tag judges by name unless he chooses to.

## SAFE claims

Each sentence is backed by a committed file. "Refresh check" means the sentence names the final core or a number that the coordinator re-records today: confirm the proof file shows the new value before it ships. `{{...}}` values are filled by `scripts/fill-submission.sh`.

| # | Safe sentence | Proof (path) |
|---|---|---|
| S1 | Kruxa is a token launch you can walk away from: buyers can take their principal back until the walk deadline. | `README.md` "What it is" (Commit and Walk) |
| S2 | The verdict rule is fixed and anyone can recompute it: PASS at the soft cap, FAIL one micro-USDC below. | `evidence/judge-run.txt` lines `outcome=PASS`, `outcome=FAIL(reasons=1)`; `CLAIMS.md` C-01, C-02 |
| S3 | In an oversubscribed launch, a 100 USDC buyer spends 40 and is refunded 60. | `evidence/judge-run.txt` line `spend=40000000 refund=60000000`; `CLAIMS.md` C-03 |
| S4 | Change one micro-USDC in a recorded launch and the verifier prints MISMATCH and exits 2. | `evidence/judge-run.txt` step T2 and line `MISMATCH log (event 30: ...)`; `evidence/verify-tamper.txt`; `CLAIMS.md` C-09 |
| S5 | Our own red team ran 100 attacks on a sandbox: 81 refused with a rule code, 14 had no effect, 5 are bounded by disclosed limits, 0 failed. It is not an audit. | `evidence/judge-run.txt` line `ATTACK GALLERY (sandbox): ...`; `CLAIMS.md` C-08 |
| S6 | A scripted swarm of 16 agents ran 24 rounds and the invariants held in every round. The agents are scripts, not language models. | `evidence/judge-run.txt` lines `SWARM GREEN`, `INVARIANTS HELD in 24 of 24 rounds ...`; `README.md` "Tracks" |
| S7 | After a PASS the creator draws at a capped stream rate; a withdraw-all reverts with `STREAM_CAP` (sandbox). | `CLAIMS.md` C-06 (gallery rows A02, A03); `docs/ATTACK-GALLERY.md` |
| S8 | On a PASS the Solana token is a fixed-supply mint with no mint authority and no freeze authority. That ran on Solana devnet only, signed through NEAR Chain Signatures. | `evidence/verify-tamper.txt` line `PASS C7 mint_authority=None freeze_authority=None`; `CLAIMS.md` C-10; `README.md` "What it is" |
| S9 | The core on NEAR testnet runs a reproducible container build, and its code hash equals the one in `artifacts/SHA256SUMS` (`{{CORE_SHA256_SHORT}}`, account `{{CORE_ACCOUNT}}`). Refresh check. | `artifacts/SHA256SUMS`; `artifacts/BUILD-KIND`; `evidence/verify/claims-C05-core7.txt` (previous account name; the final core needs its own record) |
| S10 | `make judge-fast` runs {{FAST_STEPS}} steps green with no keys and no funds; the full `make judge` ran {{JUDGE_STEPS}} steps green in {{JUDGE_WALL_S}} s. Refresh check. | `evidence/judge-fast-run.txt` last line; `evidence/judge-run.txt` last summary line |
| S11 | Three recorded swarm runs replay on NEAR testnet with every check equal. | `evidence/swarm-testnet/run-seed1-core7-run1-GREEN.json`, `evidence/swarm-testnet/run-seed2-core7-run2-GREEN.json`, `evidence/swarm-testnet/run-seed3-core7-run1-GREEN.json`; `CLAIMS.md` C-15. Refresh check if the final core is a new account |
| S12 | The sandbox loads the real `intents.near` wasm, pinned by code hash, and the core accepts cross-chain commits through `mt_on_transfer`. | `README.md` "What uses NEAR"; `tests/tests/real_intents.rs`; `SUBMISSION_STATUS.md` section 2 (S3 row) |
| S13 | The market contract splits fees five ways, holds the pool constant, and in a 60-day simulation the creator never takes more than half the fee. | `evidence/judge-run.txt` lines `SLICES OK`, `BOUND OK: creator never above 50% of the fee ...` |
| S14 | A pre-stated hypothesis about NEAR Intents activity was tested on public data with committed queries. It came out not supported, and we report it that way. | `README.md` "Tracks" (Investment Thesis); `evidence/thesis.txt` (`THESIS OK`) |
| S15 | Nothing is on mainnet and no independent audit has covered this code. | `README.md` "Limits, stated plainly"; `HONESTY.md` items 1 and 18; `SUBMISSION_STATUS.md` section 1 (Mainnet row) |

Count: 15. A post needs only two or three of these plus the video and the repo link. S15 is worth keeping in the post or the first reply.

## Must NOT be claimed

Anything below is either false, unproven, or listed by the repo as a disclosed limit. Sources: `docs/INVARIANTS.md` "MUST NOT CLAIM", `HONESTY.md`, `LIMITATIONS.md`, `CLAIMS.md` last paragraph.

| Do not say | Why | Where the repo says so |
|---|---|---|
| Anything on mainnet: deployed, live, launched, a Genesis Round, a `$KRUXA` token, a capped beta, "open" to the public | nothing Kruxa owns is on mainnet | `SUBMISSION_STATUS.md` section 1; `LIMITATIONS.md` limit 8; `docs/INVARIANTS.md` |
| Audited, reviewed, secure, safe, trustless, immutable, no admin | no audit; the owner holds a full-access key; `halt_launch` and `force_resolve_op` are owner powers | `HONESTY.md` items 1, 11, 12; `LIMITATIONS.md` limits 1 to 3, 7 |
| Live users, volume, TVL, traction, revenue, "people are using it" | none exists in the repo; all balances are testnet play money | `docs/INVARIANTS.md` (revenue and traction claims); `evidence/testnet-core7/README.md` |
| Test 1 landed: that a Solana address received funds through Intents, that Intents deposit credit works live, or any "we moved real money cross-chain" line | the receipts are thin (one NEAR transaction hash, none for OV4) and the repo forbids the claim | `HONESTY.md` item 17; `evidence/test1-ov15.json`; `docs/INVARIANTS.md` (OV4, OV15 entries); `CLAIMS.md` last paragraph |
| Phantom signing works, or the app was used with a real wallet | OV3 is unproven; the app was not exercised against a live wallet | `README.md` "Limits"; `SUBMISSION_STATUS.md` section 2 |
| Unstoppable DeFi or Agent Economy as a track | both RED in the judge run | `evidence/judge-run.txt`; `submission/track-claims.json` |
| The agents or attackers are AI or language models | scripted tests | `README.md` "Tracks" |
| The judge run rebuilds the deployed wasm, or the market and launcher are reproducible builds | B1 prints a different hash; only the core has a container build | `LIMITATIONS.md` limit 9; `artifacts/BUILD-KIND` |
| A full judge run is quick (for example "under five minutes") | the recorded full run took {{JUDGE_WALL_S}} s | `evidence/judge-run.txt`; `CLAIMS.md` last paragraph |
| "100% of your principal back" or "refunded to the origin chain" | moving off NEAR through Intents costs a quoted withdrawal fee; the relay fee is not refunded | `docs/INVARIANTS.md`; `HONESTY.md` item 5; `README.md` "What it is" |
| Sybil resistance, fair launch, price support, returns, yield | `min_funders` counts accounts, not people | `README.md` "Limits"; `HONESTY.md` item 10; `docs/INVARIANTS.md` |
| First, unique, novel, no competitor | named rivals exist | `docs/INVARIANTS.md` |
| The Solana mint, Squads vault or Meteora pool are mainnet or independent | devnet only; the demo vault is single-party; Meteora is a partial devnet spike | `HONESTY.md` item 2; `README.md` "What it is"; `SUBMISSION_STATUS.md` section 2 |
| The solvency report proves solvency; the upgrade queue stops the owner | it is informational; a full-access key bypasses the queue | `LIMITATIONS.md` limits 1 and 4 |

## Media checklist (screenshots or video)

| Asset | Source | Label to show on screen |
|---|---|---|
| Terminal: `make tour` ending in `TOUR GREEN` | `submission/video-script.md` | none needed (offline) |
| Terminal: tamper run printing `MISMATCH` | `evidence/judge-run.txt` T2 | "RECORDED launch, one micro-USDC changed" |
| Terminal: testnet CODE line `MATCH` | `evidence/wire.md` row 1 | "NEAR TESTNET, play money" |
| Card: limits (no mainnet, no audit, testnet and devnet only) | `README.md` "Limits, stated plainly" | none |
